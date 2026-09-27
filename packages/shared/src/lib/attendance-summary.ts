import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * One attendance percentage, so the assistant cannot invent a sixth.
 *
 * ── The problem this solves ─────────────────────────────────────────────────
 * Attendance is computed ad hoc in at least five places and they disagree:
 *
 *   apps/erp/src/lib/report-card.ts      year window, half_day counts as 1.0
 *   apps/erp/src/lib/report-query.ts     year window, half_day counts as 0.5
 *   apps/erp/src/lib/student-history.ts  per class, `present` only
 *   apps/erp/src/app/student/page.tsx    NO date filter, present + late
 *   .../{student,parent}/attendance      client-side, present + late
 *
 * There is also no "term" in the schema — `exam_types.kind = 'term_exam'` is a
 * label with no date range — so "attendance this term" cannot be computed at
 * all without inventing a window. Callers get the academic-year window or an
 * explicit one; nothing here guesses.
 *
 * ── Why the report-card definition is the default ───────────────────────────
 * Not because it is the most defensible arithmetic — treating a half day as a
 * whole one is generous, and report-query's 0.5 weighting is arguably better.
 * It is the default because it is the number already printed on the report
 * card in the parent's hand. An assistant that says 82% when the card says 84%
 * is wrong, whichever formula is nicer. Matching the artifact the family
 * already has beats being right in isolation.
 *
 * Pass `halfDayCredit: 0.5` to match report-query.ts where a caller needs the
 * report builder's number instead.
 *
 * Migrating the five existing call sites onto this is worth doing, but each is
 * a user-visible change to a number someone has already seen — so it belongs
 * in its own change, not smuggled into a refactor.
 */

export interface AttendanceSummary {
  /** Days with any attendance record in the window. */
  totalDays: number;
  presentDays: number;
  absentDays: number;
  lateDays: number;
  halfDays: number;
  /** present + late + (halfDays × halfDayCredit), rounded to 1dp. */
  creditedDays: number;
  /**
   * Rounded whole percent, or null when nothing was ever marked.
   *
   * Null rather than 0 on purpose: "no attendance taken" and "attended
   * nothing" are different facts, and reporting an unmarked class as 0% would
   * put a child on an at-risk list for an office oversight.
   */
  percent: number | null;
  /** The window actually used, for display and for audit. */
  from: string | null;
  to: string | null;
  academicYearLabel: string | null;
}

export interface AttendanceSummaryOptions {
  /** Defaults to the current academic year. */
  academicYearId?: string | null;
  /** Overrides the academic-year window entirely. ISO YYYY-MM-DD. */
  from?: string;
  to?: string;
  /** 1 matches report cards (default); 0.5 matches the report builder. */
  halfDayCredit?: 1 | 0.5;
}

const EMPTY: AttendanceSummary = {
  totalDays: 0,
  presentDays: 0,
  absentDays: 0,
  lateDays: 0,
  halfDays: 0,
  creditedDays: 0,
  percent: null,
  from: null,
  to: null,
  academicYearLabel: null,
};

/**
 * Attendance for one student over a window.
 *
 * Takes the Supabase client as a parameter, like `runStudentReport` and
 * `computeFinalResult`, so it is callable from a route handler, a tool
 * executor, or a PDF renderer without assuming a session.
 */
export async function computeAttendanceSummary(
  supabase: SupabaseClient,
  studentId: string,
  options: AttendanceSummaryOptions = {}
): Promise<AttendanceSummary> {
  const halfDayCredit = options.halfDayCredit ?? 1;

  let from = options.from ?? null;
  let to = options.to ?? null;
  let academicYearLabel: string | null = null;

  // Resolve the year window unless the caller gave an explicit one. Honouring
  // a requested year matters: hardcoding is_current once made a past-year
  // report card count this year's attendance.
  if (!from || !to) {
    const query = supabase
      .from("academic_years")
      .select("id, name, start_date, end_date");
    const { data: year } = options.academicYearId
      ? await query.eq("id", options.academicYearId).limit(1).maybeSingle()
      : await query.eq("is_current", true).limit(1).maybeSingle();

    if (year) {
      academicYearLabel = (year.name as string) ?? null;
      from = from ?? ((year.start_date as string) ?? null);
      to = to ?? ((year.end_date as string) ?? null);
    }
  }

  let query = supabase
    .from("attendance")
    .select("status")
    .eq("student_id", studentId);

  if (from) query = query.gte("date", from);
  if (to) query = query.lte("date", to);

  const { data: rows, error } = await query;
  if (error || !rows) {
    return { ...EMPTY, from, to, academicYearLabel };
  }

  let presentDays = 0;
  let absentDays = 0;
  let lateDays = 0;
  let halfDays = 0;

  for (const row of rows) {
    switch (row.status as string) {
      case "present": presentDays += 1; break;
      case "absent": absentDays += 1; break;
      case "late": lateDays += 1; break;
      case "half_day": halfDays += 1; break;
      // An unrecognised status still counts toward the denominator: the day
      // was marked, and silently dropping it would inflate the percentage.
      default: break;
    }
  }

  const totalDays = rows.length;
  const creditedRaw = presentDays + lateDays + halfDays * halfDayCredit;
  const creditedDays = Math.round(creditedRaw * 10) / 10;

  return {
    totalDays,
    presentDays,
    absentDays,
    lateDays,
    halfDays,
    creditedDays,
    percent: totalDays > 0 ? Math.round((creditedRaw / totalDays) * 100) : null,
    from,
    to,
    academicYearLabel,
  };
}
