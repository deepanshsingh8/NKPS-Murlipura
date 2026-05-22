import { NextRequest, NextResponse } from "next/server";
import { renderToBuffer } from "@react-pdf/renderer";
import { verifyAdminOrEditor } from "@nkps/shared/lib/verify-admin";
import { DailySubstitutionSheetPDF, type DailySubstitutionRow } from "@/components/pdf/DailySubstitutionSheetPDF";
import { SCHOOL } from "@nkps/shared/lib/constants";
import { HALF_DAY_CUTOFF_PERIOD } from "@nkps/shared/lib/constants";

export const runtime = "nodejs";

const WEEKDAY_LABELS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

interface AbsenceRow {
  id: string;
  teacher_id: string;
  half_day: "full" | "first_half" | "second_half";
  teachers:
    | { full_name: string }
    | { full_name: string }[]
    | null;
}

interface PeriodRow {
  id: string;
  period_number: number;
  start_time: string;
  end_time: string;
  room: string | null;
  classes:
    | { name: string; section: string | null }
    | { name: string; section: string | null }[]
    | null;
  subjects:
    | { name: string }
    | { name: string }[]
    | null;
}

interface SubstitutionRow {
  id: string;
  absence_id: string;
  timetable_period_id: string;
  note: string | null;
  substitute:
    | { full_name: string }
    | { full_name: string }[]
    | null;
}

function pickOne<T>(rel: T | T[] | null | undefined): T | null {
  if (!rel) return null;
  return Array.isArray(rel) ? (rel[0] ?? null) : rel;
}

function dayOfWeekFromIsoDate(yyyymmdd: string): number {
  const d = new Date(`${yyyymmdd}T12:00:00`);
  return d.getDay();
}

export async function GET(request: NextRequest) {
  const admin = await verifyAdminOrEditor("teacher_substitutions");
  if (!admin) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const date = request.nextUrl.searchParams.get("date");
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json(
      { error: "date is required (YYYY-MM-DD)" },
      { status: 400 }
    );
  }

  // 1. Absences on this date.
  const { data: absences, error: absErr } = await admin
    .from("teacher_absences")
    .select(
      "id, teacher_id, half_day, teachers(full_name)"
    )
    .eq("absence_date", date);
  if (absErr) {
    console.error("[substitutions.sheet.GET] absences fetch:", absErr);
    return NextResponse.json({ error: "Failed to load absences" }, { status: 500 });
  }
  const typedAbsences = (absences ?? []) as AbsenceRow[];

  if (typedAbsences.length === 0) {
    return NextResponse.json(
      { error: "No absences recorded for this date." },
      { status: 404 }
    );
  }

  const absenceById = new Map(typedAbsences.map((a) => [a.id, a]));
  const teacherIds = typedAbsences.map((a) => a.teacher_id);
  const dayOfWeek = dayOfWeekFromIsoDate(date);

  // 2. Affected periods for those teachers on that weekday.
  const { data: periods, error: periodsErr } = await admin
    .from("timetable_periods")
    .select(
      "id, teacher_id, period_number, start_time, end_time, room, is_break, classes(name, section), subjects(name)"
    )
    .in("teacher_id", teacherIds)
    .eq("day_of_week", dayOfWeek)
    .eq("is_break", false);
  if (periodsErr) {
    console.error("[substitutions.sheet.GET] periods fetch:", periodsErr);
    return NextResponse.json({ error: "Failed to load periods" }, { status: 500 });
  }

  // Map periods → absent teacher.
  const teacherIdByPeriodId = new Map<string, string>();
  for (const p of periods ?? []) {
    if (p.teacher_id) teacherIdByPeriodId.set(p.id, p.teacher_id);
  }
  const absentByTeacher = new Map<string, AbsenceRow>();
  for (const a of typedAbsences) absentByTeacher.set(a.teacher_id, a);

  // 3. All substitutions for these absences (assigned subs).
  const { data: subs, error: subsErr } = await admin
    .from("substitutions")
    .select(
      "id, absence_id, timetable_period_id, note, substitute:teachers!substitutions_substitute_teacher_id_fkey(full_name)"
    )
    .in("absence_id", typedAbsences.map((a) => a.id));
  if (subsErr) {
    console.error("[substitutions.sheet.GET] subs fetch:", subsErr);
    return NextResponse.json({ error: "Failed to load substitutions" }, { status: 500 });
  }
  const subByPeriodAbsenceKey = new Map<string, SubstitutionRow>();
  for (const s of (subs ?? []) as SubstitutionRow[]) {
    subByPeriodAbsenceKey.set(`${s.absence_id}|${s.timetable_period_id}`, s);
  }

  // 4. Build PDF rows. Filter periods by the absence's half_day.
  const assigned: DailySubstitutionRow[] = [];
  const unassigned: DailySubstitutionRow[] = [];

  for (const p of (periods ?? []) as PeriodRow[] & { teacher_id: string }[]) {
    const tid = teacherIdByPeriodId.get(p.id);
    if (!tid) continue;
    const absence = absentByTeacher.get(tid);
    if (!absence) continue;

    // Half-day filter.
    if (absence.half_day === "first_half" && p.period_number > HALF_DAY_CUTOFF_PERIOD) continue;
    if (absence.half_day === "second_half" && p.period_number <= HALF_DAY_CUTOFF_PERIOD) continue;

    const cls = pickOne(p.classes);
    const subj = pickOne(p.subjects);
    const teacher = pickOne(absence.teachers);
    const sub = subByPeriodAbsenceKey.get(`${absence.id}|${p.id}`);
    const subTeacher = sub ? pickOne(sub.substitute) : null;

    const row: DailySubstitutionRow = {
      start_time: p.start_time,
      end_time: p.end_time,
      period_number: p.period_number,
      class_label: cls
        ? `${cls.name}${cls.section ? "-" + cls.section : ""}`
        : "?",
      subject_name: subj?.name ?? "—",
      room: p.room,
      absent_teacher_name: teacher?.full_name ?? "Unknown",
      substitute_teacher_name: subTeacher?.full_name ?? null,
      half_day: absence.half_day,
      note: sub?.note ?? null,
    };

    if (subTeacher) assigned.push(row);
    else unassigned.push(row);
  }

  // Sort by start_time then class_label.
  const byTime = (a: DailySubstitutionRow, b: DailySubstitutionRow) => {
    if (a.start_time !== b.start_time) return a.start_time.localeCompare(b.start_time);
    return a.class_label.localeCompare(b.class_label);
  };
  assigned.sort(byTime);
  unassigned.sort(byTime);

  const generatedOn = new Date().toLocaleString("en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
  });

  // Use absenceById to keep TS happy (lookup map could be reused later).
  void absenceById;

  const buffer = await renderToBuffer(
    <DailySubstitutionSheetPDF
      school={{
        name: SCHOOL.name,
        address_line: SCHOOL.address.full,
      }}
      date={date}
      weekday_label={WEEKDAY_LABELS[dayOfWeek] ?? ""}
      rows={assigned}
      unassigned={unassigned}
      generated_on={generatedOn}
    />
  );

  return new NextResponse(buffer as unknown as BodyInit, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="substitution-sheet-${date}.pdf"`,
    },
  });
}
