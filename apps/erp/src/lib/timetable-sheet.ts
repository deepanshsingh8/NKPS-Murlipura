import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  TimetableGridCell,
  TimetableGridGroup,
  TimetableGridPeriodRow,
} from "@/components/pdf/TimetableGridPDF";

/**
 * Loads a week's timetable in the shape TimetableGridPDF wants.
 *
 * One helper for both sheets so the class view and the teacher view cannot
 * drift apart. They differ only in what fills each cell's second line — a
 * class sheet names the teacher, a teacher sheet names the class — and in the
 * fact that a teacher's week spans classes, which is what makes the shared
 * ordering below matter.
 */

interface PeriodRow {
  day_of_week: number;
  period_number: number;
  start_time: string;
  end_time: string;
  room: string | null;
  is_break: boolean;
  group_no: number | null;
  group_label: string | null;
  subjects: { name: string } | { name: string }[] | null;
  teachers: { full_name: string } | { full_name: string }[] | null;
  classes:
    | { name: string; section: string | null }
    | { name: string; section: string | null }[]
    | null;
}

// PostgREST returns a single-relation join as an object or a one-element array
// depending on how the FK is declared; normalise both.
function pickOne<T>(rel: T | T[] | null | undefined): T | null {
  if (!rel) return null;
  return Array.isArray(rel) ? (rel[0] ?? null) : rel;
}

const SELECT =
  "day_of_week, period_number, start_time, end_time, room, is_break, group_no, group_label, " +
  "subjects(name), teachers(full_name), classes(name, section)";

export interface TimetableSheetData {
  periods: TimetableGridPeriodRow[];
  cells: TimetableGridCell[];
}

/**
 * @param mode "class" puts the teacher on the cell's second line; "teacher"
 *             puts the class there.
 */
export async function fetchTimetableSheet(
  admin: SupabaseClient,
  mode: "class" | "teacher",
  id: string
): Promise<TimetableSheetData> {
  const { data, error } = await admin
    .from("timetable_periods")
    .select(SELECT)
    .eq(mode === "class" ? "class_id" : "teacher_id", id)
    .order("day_of_week")
    .order("period_number")
    // Parallel groups tie on period_number. Without this the printed sheet
    // orders its Games groups differently on every run, and two copies of the
    // same timetable do not match. (migration 119)
    .order("group_no");

  if (error) throw new Error(error.message);
  const rows = (data ?? []) as unknown as PeriodRow[];

  // Bell times come from the rows themselves rather than a period template:
  // a teacher's week spans classes that may run staggered schedules, and the
  // class sheet should print the times its own rows actually carry.
  //
  // Where a period number appears with more than one time — the staggered
  // case — the earliest start wins, so the column stays in reading order.
  const periodByNum = new Map<number, TimetableGridPeriodRow>();
  for (const r of rows) {
    const existing = periodByNum.get(r.period_number);
    if (!existing || r.start_time < existing.start_time) {
      periodByNum.set(r.period_number, {
        period_number: r.period_number,
        start_time: r.start_time,
        end_time: r.end_time,
      });
    }
  }
  const periods = [...periodByNum.values()].sort(
    (a, b) => a.period_number - b.period_number
  );

  const cellMap = new Map<string, TimetableGridCell>();
  for (const r of rows) {
    const key = `${r.day_of_week}|${r.period_number}`;
    const subject = pickOne(r.subjects)?.name ?? null;
    const teacher = pickOne(r.teachers)?.full_name ?? null;
    const cls = pickOne(r.classes);
    const classLabel = cls
      ? `${cls.name}${cls.section ? `-${cls.section}` : ""}`
      : null;

    const group: TimetableGridGroup = {
      group_no: r.group_no ?? 0,
      group_label: r.group_label,
      subject_name: subject,
      counterpart: mode === "class" ? teacher : classLabel,
      room: r.room,
      is_break: r.is_break === true,
    };

    const cell = cellMap.get(key);
    if (cell) cell.groups.push(group);
    else
      cellMap.set(key, {
        day_of_week: r.day_of_week,
        period_number: r.period_number,
        groups: [group],
      });
  }

  return { periods, cells: [...cellMap.values()] };
}
