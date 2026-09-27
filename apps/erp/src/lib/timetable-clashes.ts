/**
 * Turning `timetable_teacher_clashes` into the two lists an admin can act on.
 *
 * The view emits one row per overlapping PAIR of periods, which is the wrong
 * shape to put on a screen: a coach shared across four sections is C(4,2) = 6
 * rows, and a Games period across eight sections is 84 rows for one period of
 * one day. Pure functions, kept out of the component so they can be tested.
 */

export interface ClashViewRow {
  teacher_id: string | null;
  teacher_name: string | null;
  day_of_week: number;
  period_a: string;
  class_a: string | null;
  a_start: string;
  a_end: string;
  a_shared: boolean | null;
  period_b: string;
  class_b: string | null;
  b_start: string;
  b_end: string;
  b_shared: boolean | null;
}

/** One line per teacher/day/time, naming every class taken together. */
export interface SharedBooking {
  id: string;
  teacher_name: string;
  day_of_week: number;
  start_time: string;
  end_time: string;
  classes: string[];
}

/** A genuine double-booking: two cells that should never have overlapped. */
export interface ClashProblem {
  id: string;
  teacher_name: string;
  day_of_week: number;
  class_a: string;
  a_time: string;
  class_b: string;
  b_time: string;
}

function hhmm(t: string): string {
  return t && t.length >= 5 ? t.slice(0, 5) : t;
}

/** True when NEITHER side was marked shared — so nobody chose this overlap. */
export function isAccidental(r: ClashViewRow): boolean {
  return r.a_shared !== true && r.b_shared !== true;
}

/**
 * The actionable list. The exclusion constraint refuses these on the normal
 * path, so anything here predates migration 119 or arrived through a
 * service-role write that bypassed it — either way it will not clear itself.
 */
export function accidentalClashes(rows: ClashViewRow[]): ClashProblem[] {
  return rows.filter(isAccidental).map((r) => ({
    id: `${r.period_a}|${r.period_b}`,
    teacher_name: r.teacher_name ?? "—",
    day_of_week: r.day_of_week,
    class_a: r.class_a ?? "—",
    a_time: `${hhmm(r.a_start)}–${hhmm(r.a_end)}`,
    class_b: r.class_b ?? "—",
    b_time: `${hhmm(r.b_start)}–${hhmm(r.b_end)}`,
  }));
}

/**
 * The deliberate ones, folded back into one line each.
 *
 * Every pair among N classes appears in the view, so unioning both sides of
 * every pair recovers the full set of N — six rows become one line naming four
 * classes. Keyed on the times as well as the teacher and day, so two genuinely
 * different shared periods on the same day stay apart.
 */
export function sharedBookings(rows: ClashViewRow[]): SharedBooking[] {
  const byBooking = new Map<string, SharedBooking>();
  for (const r of rows) {
    if (isAccidental(r)) continue;
    const key = `${r.teacher_id}|${r.day_of_week}|${r.a_start}|${r.a_end}`;
    const entry = byBooking.get(key) ?? {
      id: key,
      teacher_name: r.teacher_name ?? "—",
      day_of_week: r.day_of_week,
      start_time: r.a_start,
      end_time: r.a_end,
      classes: [],
    };
    for (const c of [r.class_a, r.class_b]) {
      if (c && !entry.classes.includes(c)) entry.classes.push(c);
    }
    byBooking.set(key, entry);
  }
  const out = [...byBooking.values()];
  for (const e of out) e.classes.sort();
  return out;
}
