import type { SupabaseClient } from "@supabase/supabase-js";
import { HALF_DAY_CUTOFF_PERIOD } from "@nkps/shared/lib/constants";

// Availability re-check for the substitution WRITE path. The suggest endpoint
// already filters unavailable teachers, but the POST/PATCH handlers trust the
// client — so an absent or already-booked teacher could be assigned. This
// mirrors the suggest endpoint's checks (TIME-RANGE overlap, not period_number
// equality, because classes run staggered schedules) and is the authority the
// write path enforces.

function timesOverlap(
  aStart: string,
  aEnd: string,
  bStart: string,
  bEnd: string
): boolean {
  return aStart < bEnd && aEnd > bStart;
}

/**
 * Returns a human-readable reason the substitute can't take this period, or
 * null if they're available. Existence of the period/absence is the caller's
 * responsibility — a missing row yields null (no conflict) so callers keep
 * their own 404s.
 */
export async function findSubstituteConflict(
  admin: SupabaseClient,
  params: {
    substituteTeacherId: string;
    absenceId: string;
    timetablePeriodId: string;
  }
): Promise<string | null> {
  const { substituteTeacherId, absenceId, timetablePeriodId } = params;

  const [{ data: period }, { data: absence }] = await Promise.all([
    admin
      .from("timetable_periods")
      .select("start_time, end_time, day_of_week, period_number")
      .eq("id", timetablePeriodId)
      .maybeSingle(),
    admin
      .from("teacher_absences")
      .select("absence_date, half_day")
      .eq("id", absenceId)
      .maybeSingle(),
  ]);
  if (!period || !absence) return null;

  const isFirstHalfPeriod = period.period_number <= HALF_DAY_CUTOFF_PERIOD;

  // 1. The substitute can't be absent themselves at that time.
  const { data: subAbsences } = await admin
    .from("teacher_absences")
    .select("half_day")
    .eq("teacher_id", substituteTeacherId)
    .eq("absence_date", absence.absence_date);
  for (const a of subAbsences ?? []) {
    const hd = a.half_day as string;
    if (
      hd === "full" ||
      (hd === "first_half" && isFirstHalfPeriod) ||
      (hd === "second_half" && !isFirstHalfPeriod)
    ) {
      return "The selected teacher is marked absent at that time.";
    }
  }

  // 2. The substitute can't already have a regular class overlapping this slot.
  const { data: busy } = await admin
    .from("timetable_periods")
    .select("start_time, end_time")
    .eq("teacher_id", substituteTeacherId)
    .eq("day_of_week", period.day_of_week)
    .eq("is_break", false);
  if (
    (busy ?? []).some((b) =>
      timesOverlap(b.start_time, b.end_time, period.start_time, period.end_time)
    )
  ) {
    return "The selected teacher already has a class scheduled at that time.";
  }

  // 3. The substitute can't already be covering another substitution that
  //    overlaps this slot on the same date (excluding the very row we're about
  //    to upsert/replace).
  const { data: dateSubs } = await admin
    .from("substitutions")
    .select(
      "absence_id, timetable_period_id, timetable_periods(start_time, end_time), teacher_absences!inner(absence_date)"
    )
    .eq("substitute_teacher_id", substituteTeacherId)
    .eq("teacher_absences.absence_date", absence.absence_date);
  for (const s of dateSubs ?? []) {
    if (s.absence_id === absenceId && s.timetable_period_id === timetablePeriodId) {
      continue;
    }
    const tp = s.timetable_periods as unknown as
      | { start_time: string; end_time: string }
      | null;
    if (
      tp &&
      timesOverlap(tp.start_time, tp.end_time, period.start_time, period.end_time)
    ) {
      return "The selected teacher is already substituting another class at that time.";
    }
  }

  return null;
}
