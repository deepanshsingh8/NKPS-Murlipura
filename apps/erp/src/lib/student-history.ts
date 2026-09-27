import type { SupabaseClient } from "@supabase/supabase-js";
import { resolveGradeScalesForClasses, computeGrade } from "@/lib/grading";

/**
 * A student's record across every academic year they have been enrolled for.
 *
 * The data has always accumulated correctly — classes are year-scoped and
 * promotion INSERTS a new enrollment rather than mutating the old one — but
 * nothing ever surfaced it: `GET /api/students` collapses N enrollments to one
 * "representative" row and discards the rest.
 *
 * Deliberately assembled from SEVEN parallel queries rather than by calling
 * getReportCardData() once per year. That would be five round trips per year,
 * so eight years of history would cost forty; this costs seven regardless of
 * depth.
 */

export interface HistoryYearEnrollment {
  id: string;
  class_name: string | null;
  class_section: string | null;
  stream_name: string | null;
  roll_number: number | null;
  status: string;
  status_reason: string | null;
  status_changed_at: string | null;
  enrollment_date: string | null;
  source: string;
}

export interface HistoryExam {
  exam_type_id: string;
  name: string;
  sort_order: number;
  subjects_counted: number;
  total_obtained: number;
  total_max: number;
  percentage: number | null;
  grade: string | null;
  is_published: boolean;
}

export interface HistoryYear {
  academic_year: {
    id: string;
    name: string;
    start_date: string | null;
    end_date: string | null;
    is_current: boolean;
  };
  enrollment: HistoryYearEnrollment | null;
  exams: HistoryExam[];
  attendance: {
    total_days: number;
    present_days: number;
    percentage: number | null;
  };
  fees: {
    paid: number;
    waived: number;
    receipts: number;
    last_payment_date: string | null;
  };
  marksheets: {
    id: string;
    kind: string;
    version: number;
    published_at: string | null;
    unpublished_at: string | null;
  }[];
  status_events: {
    from_status: string | null;
    to_status: string;
    reason: string | null;
    source: string;
    changed_at: string;
  }[];
}

export interface HistoryGap {
  academic_year_id: string;
  year_name: string;
  reason: "results_without_enrollment" | "fees_without_enrollment";
}

export interface StudentHistory {
  student: {
    id: string;
    full_name: string;
    admission_no: string;
    father_name: string | null;
    is_alumni: boolean | null;
    alumni_passing_year: string | null;
  } | null;
  years: HistoryYear[];
  gaps: HistoryGap[];
}

type Db = SupabaseClient;

function pickOne<T>(rel: T | T[] | null | undefined): T | null {
  if (Array.isArray(rel)) return rel[0] ?? null;
  return rel ?? null;
}

export async function getStudentHistory(
  admin: Db,
  studentId: string
): Promise<StudentHistory> {
  const [
    studentRes,
    yearsRes,
    enrollmentsRes,
    resultsRes,
    attendanceRes,
    paymentsRes,
    marksheetsRes,
    statusRes,
  ] = await Promise.all([
    admin
      .from("students")
      .select("id, full_name, admission_no, father_name, is_alumni, alumni_passing_year")
      .eq("id", studentId)
      .maybeSingle(),
    admin
      .from("academic_years")
      .select("id, name, start_date, end_date, is_current")
      .order("start_date", { ascending: false }),
    admin
      .from("student_enrollments")
      .select(
        "id, class_id, academic_year_id, roll_number, status, status_reason, status_changed_at, enrollment_date, source, classes(name, section), streams:stream_id(name)"
      )
      .eq("student_id", studentId),
    // Same select as api/results/by-student — that endpoint already returns
    // every year's results; it just never groups them by year.
    admin
      .from("results")
      .select(
        "marks_obtained, max_marks, is_published, class_id, exam_type_id, subject_id, exam_types(id, name, max_marks, sort_order, academic_year_id)"
      )
      .eq("student_id", studentId),
    // No year filter needed: attendance.class_id is year-scoped, so grouping
    // rows by their class's enrollment year partitions them exactly.
    admin
      .from("attendance")
      .select("class_id, status")
      .eq("student_id", studentId),
    admin
      .from("fee_payments")
      .select("academic_year_id, amount_paid, waiver_amount, status, payment_date")
      .eq("student_id", studentId),
    // Metadata only — never `snapshot`, which is a jsonb blob per publication.
    admin
      .from("marksheet_publications")
      .select("id, kind, version, academic_year_id, published_at, unpublished_at")
      .eq("student_id", studentId)
      .is("unpublished_at", null),
    admin
      .from("student_status_history")
      .select("academic_year_id, from_status, to_status, reason, source, changed_at")
      .eq("student_id", studentId)
      .order("changed_at", { ascending: false }),
  ]);

  for (const [label, res] of [
    ["student", studentRes],
    ["years", yearsRes],
    ["enrollments", enrollmentsRes],
    ["results", resultsRes],
    ["attendance", attendanceRes],
    ["payments", paymentsRes],
    ["marksheets", marksheetsRes],
    ["status", statusRes],
  ] as const) {
    if (res.error) {
      console.error(`[getStudentHistory] ${label} query failed:`, res.error);
    }
  }

  const enrollments = enrollmentsRes.data ?? [];
  const years = yearsRes.data ?? [];

  // class_id → academic_year_id, the key that lets attendance (which carries
  // only class_id) be bucketed by year.
  const yearByClass = new Map<string, string>();
  for (const e of enrollments) {
    if (e.class_id && e.academic_year_id) {
      yearByClass.set(e.class_id as string, e.academic_year_id as string);
    }
  }

  // Grades are recomputed from the live scale rather than read from
  // results.grade, so a Grade Master edit is reflected here the same way it is
  // on report cards.
  const classIds = [...new Set(enrollments.map((e) => e.class_id as string))].filter(Boolean);
  const scaleByClass = classIds.length
    ? await resolveGradeScalesForClasses(admin, classIds)
    : new Map();

  // ── Results → per-year, per-exam totals ──
  type ExamAcc = {
    exam_type_id: string;
    name: string;
    sort_order: number;
    subjects_counted: number;
    total_obtained: number;
    total_max: number;
    is_published: boolean;
    class_id: string | null;
  };
  const examsByYear = new Map<string, Map<string, ExamAcc>>();

  for (const r of resultsRes.data ?? []) {
    const exam = pickOne(
      r.exam_types as unknown as {
        id: string;
        name: string;
        max_marks: number | null;
        sort_order: number | null;
        academic_year_id: string | null;
      } | null
    );
    const yearId = exam?.academic_year_id;
    if (!yearId || !exam) continue;

    const forYear = examsByYear.get(yearId) ?? new Map<string, ExamAcc>();
    const acc =
      forYear.get(exam.id) ??
      ({
        exam_type_id: exam.id,
        name: exam.name,
        sort_order: exam.sort_order ?? 0,
        subjects_counted: 0,
        total_obtained: 0,
        total_max: 0,
        is_published: true,
        class_id: (r.class_id as string) ?? null,
      } satisfies ExamAcc);

    const obtained = Number(r.marks_obtained);
    if (Number.isFinite(obtained)) {
      acc.subjects_counted += 1;
      acc.total_obtained += obtained;
      acc.total_max += Number(r.max_marks ?? exam.max_marks ?? 0);
    }
    // One unpublished subject makes the whole exam unpublished for display.
    if (r.is_published === false) acc.is_published = false;

    forYear.set(exam.id, acc);
    examsByYear.set(yearId, forYear);
  }

  // ── Attendance → per-year tallies ──
  const attendanceByYear = new Map<string, { total: number; present: number }>();
  for (const a of attendanceRes.data ?? []) {
    const yearId = yearByClass.get(a.class_id as string);
    if (!yearId) continue;
    const acc = attendanceByYear.get(yearId) ?? { total: 0, present: 0 };
    acc.total += 1;
    // Half-days count as half a day present, matching the report card.
    if (a.status === "present" || a.status === "late") acc.present += 1;
    else if (a.status === "half_day") acc.present += 0.5;
    attendanceByYear.set(yearId, acc);
  }

  // ── Fees → per-year totals. Paid/waived only, never "outstanding": fee
  // structures are rewritten each year, so pricing an old year against today's
  // structures would invent a number. ──
  const feesByYear = new Map<
    string,
    { paid: number; waived: number; receipts: number; last: string | null }
  >();
  for (const p of paymentsRes.data ?? []) {
    const yearId = p.academic_year_id as string | null;
    if (!yearId) continue;
    if (p.status && !["paid", "partial"].includes(p.status as string)) continue;
    const acc = feesByYear.get(yearId) ?? { paid: 0, waived: 0, receipts: 0, last: null };
    acc.paid += Number(p.amount_paid ?? 0);
    acc.waived += Number(p.waiver_amount ?? 0);
    acc.receipts += 1;
    const d = p.payment_date as string | null;
    if (d && (!acc.last || d > acc.last)) acc.last = d;
    feesByYear.set(yearId, acc);
  }

  const marksheetsByYear = new Map<string, HistoryYear["marksheets"]>();
  for (const m of marksheetsRes.data ?? []) {
    const yearId = m.academic_year_id as string | null;
    if (!yearId) continue;
    const list = marksheetsByYear.get(yearId) ?? [];
    list.push({
      id: m.id as string,
      kind: m.kind as string,
      version: m.version as number,
      published_at: m.published_at as string | null,
      unpublished_at: m.unpublished_at as string | null,
    });
    marksheetsByYear.set(yearId, list);
  }

  const statusByYear = new Map<string, HistoryYear["status_events"]>();
  for (const h of statusRes.data ?? []) {
    const yearId = h.academic_year_id as string | null;
    if (!yearId) continue;
    const list = statusByYear.get(yearId) ?? [];
    list.push({
      from_status: h.from_status as string | null,
      to_status: h.to_status as string,
      reason: h.reason as string | null,
      source: h.source as string,
      changed_at: h.changed_at as string,
    });
    statusByYear.set(yearId, list);
  }

  const enrollmentByYear = new Map<string, (typeof enrollments)[number]>();
  for (const e of enrollments) {
    enrollmentByYear.set(e.academic_year_id as string, e);
  }

  // Only years the student actually has *something* in.
  const touchedYears = new Set<string>([
    ...enrollmentByYear.keys(),
    ...examsByYear.keys(),
    ...attendanceByYear.keys(),
    ...feesByYear.keys(),
    ...marksheetsByYear.keys(),
  ]);

  const historyYears: HistoryYear[] = years
    .filter((y) => touchedYears.has(y.id as string))
    .map((y) => {
      const yearId = y.id as string;
      const e = enrollmentByYear.get(yearId);
      const cls = pickOne(e?.classes as unknown as { name: string; section: string } | null);
      const stream = pickOne(e?.streams as unknown as { name: string } | null);
      const att = attendanceByYear.get(yearId);
      const fee = feesByYear.get(yearId);

      const exams = [...(examsByYear.get(yearId)?.values() ?? [])]
        .sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name))
        .map((acc): HistoryExam => {
          const pct =
            acc.total_max > 0 ? (acc.total_obtained / acc.total_max) * 100 : null;
          const scale = acc.class_id ? scaleByClass.get(acc.class_id) : null;
          return {
            exam_type_id: acc.exam_type_id,
            name: acc.name,
            sort_order: acc.sort_order,
            subjects_counted: acc.subjects_counted,
            total_obtained: acc.total_obtained,
            total_max: acc.total_max,
            percentage: pct === null ? null : Math.round(pct * 100) / 100,
            grade:
              pct !== null && scale?.bands?.length
                ? computeGrade(pct, scale.bands)
                : null,
            is_published: acc.is_published,
          };
        });

      return {
        academic_year: {
          id: yearId,
          name: y.name as string,
          start_date: (y.start_date as string) ?? null,
          end_date: (y.end_date as string) ?? null,
          is_current: Boolean(y.is_current),
        },
        enrollment: e
          ? {
              id: e.id as string,
              class_name: cls?.name ?? null,
              class_section: cls?.section ?? null,
              stream_name: stream?.name ?? null,
              roll_number: (e.roll_number as number) ?? null,
              status: e.status as string,
              status_reason: (e.status_reason as string) ?? null,
              status_changed_at: (e.status_changed_at as string) ?? null,
              enrollment_date: (e.enrollment_date as string) ?? null,
              source: (e.source as string) ?? "erp_native",
            }
          : null,
        exams,
        attendance: {
          total_days: att?.total ?? 0,
          present_days: att?.present ?? 0,
          percentage:
            att && att.total > 0
              ? Math.round((att.present / att.total) * 10000) / 100
              : null,
        },
        fees: {
          paid: fee?.paid ?? 0,
          waived: fee?.waived ?? 0,
          receipts: fee?.receipts ?? 0,
          last_payment_date: fee?.last ?? null,
        },
        marksheets: marksheetsByYear.get(yearId) ?? [],
        status_events: statusByYear.get(yearId) ?? [],
      };
    });

  // A year with results or payments but NO enrollment row means something was
  // imported without one — the historical results importer used to do exactly
  // that. Anything joining through student_enrollments (report cards, sheets,
  // roll numbers, final-result compute) cannot see the student in that class,
  // so the gap is worth showing rather than silently tolerating.
  const yearNameById = new Map(years.map((y) => [y.id as string, y.name as string]));
  const gaps: HistoryGap[] = [];
  for (const yearId of examsByYear.keys()) {
    if (!enrollmentByYear.has(yearId)) {
      gaps.push({
        academic_year_id: yearId,
        year_name: yearNameById.get(yearId) ?? "Unknown year",
        reason: "results_without_enrollment",
      });
    }
  }
  for (const yearId of feesByYear.keys()) {
    if (!enrollmentByYear.has(yearId) && !examsByYear.has(yearId)) {
      gaps.push({
        academic_year_id: yearId,
        year_name: yearNameById.get(yearId) ?? "Unknown year",
        reason: "fees_without_enrollment",
      });
    }
  }

  return {
    student: (studentRes.data as StudentHistory["student"]) ?? null,
    years: historyYears,
    gaps,
  };
}
