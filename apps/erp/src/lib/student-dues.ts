import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  EffectiveFeeLine,
  FeeStructure,
  TransportDirection,
} from "@nkps/shared/types";
import { todayISO } from "@nkps/shared/lib/date";
import {
  computeDuesBreakdown,
  resolveBillingCutoff,
  resolveEffectiveFeeLines,
  resolveStudentType,
  type DuesPaymentRow,
  type StopFeeLookup,
} from "./fees";

export interface StudentDues {
  /** Outstanding amount in rupees, clamped at 0 and rounded. */
  total: number;
  hasOutstanding: boolean;
}

// The dues download-lock applies only to the people who download for
// themselves/their child — students and parents. Admin, staff and teachers
// (who pull admit cards/results operationally) are never blocked. Returns true
// when the dues gate should be enforced for this user.
export async function dueGateApplies(
  supabase: SupabaseClient,
  userId: string
): Promise<boolean> {
  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", userId)
    .maybeSingle();
  const role = profile?.role as string | undefined;
  return role === "student" || role === "parent";
}

// Outstanding fee dues for a single student, used to gate admit-card and
// report-card downloads. Runs the same computeDuesBreakdown() the fee screens
// and the office's dues register run, over the same inputs — fee lines
// narrowed to this student, receipts scoped to the billed academic year — so
// the gating amount tracks the "Payable Now" figure the family already sees.
// Pass a service-role client to bypass RLS.
//
// The one deliberate divergence is the late fee: the gate drops that term, so
// it is always the more lenient of the two. Erring lenient is the safe
// direction — a child should not lose their admit card over a surcharge — and
// the comments in student/fees and parent/fees say the same. Do not make the
// gate stricter without updating them too.
//
// Billed-to-date, not the annual total: a session's later instalments are not
// arrears yet, and gating on them would lock a fully paid-up student out of
// their admit card in April over a fee that isn't payable until January.
export async function getStudentOutstandingDues(
  admin: SupabaseClient,
  studentId: string
): Promise<StudentDues> {
  const { data: enrollment, error: enrollmentError } = await admin
    .from("student_enrollments")
    .select(
      "class_id, stream_id, academic_year_id, has_transport, bus_stop_id, transport_direction, transport_fee_override, status, exit_date, status_changed_at, classes(name)"
    )
    .eq("student_id", studentId)
    .order("enrollment_date", { ascending: false })
    .limit(1)
    .maybeSingle();

  // Never swallow a DB error here: a silent failure would leave the fee lines
  // or the receipts empty, which either falsely blocks a paid-up student from
  // downloading or falsely opens the gate. Propagate so the caller fails the
  // request explicitly instead of mis-gating.
  if (enrollmentError) {
    throw new Error(`Failed to load enrollment for dues: ${enrollmentError.message}`);
  }
  if (!enrollment) return { total: 0, hasOutstanding: false };

  const className =
    (enrollment.classes as unknown as { name: string } | null)?.name ?? "";
  const streamId = (enrollment.stream_id as string | null) ?? null;
  const hasTransport = Boolean(enrollment.has_transport);
  const busStopId = (enrollment.bus_stop_id as string | null) ?? null;
  const direction =
    ((enrollment.transport_direction as string | null) ??
      "both") as TransportDirection;
  const feeOverride =
    enrollment.transport_fee_override != null
      ? Number(enrollment.transport_fee_override)
      : null;
  const academicYearId =
    (enrollment.academic_year_id as string | null) ?? null;

  // Schedule rows may be restricted to newly-admitted or returning students
  // (migration 085). Gating on a fee the student never owed would block a
  // returning student's downloads over an admission fee, so classify them the
  // same way the fees screens do — by admission date against the billed year.
  const [{ data: studentRow }, { data: yearRow }] = await Promise.all([
    admin
      .from("students")
      .select("admission_date")
      .eq("id", studentId)
      .maybeSingle(),
    academicYearId
      ? admin
          .from("academic_years")
          .select("start_date, end_date")
          .eq("id", academicYearId)
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  const year =
    (yearRow as { start_date: string | null; end_date: string | null } | null) ??
    null;
  const studentType = resolveStudentType(
    (studentRow?.admission_date as string | null) ?? null,
    year
  );
  // One "today" for the whole calculation, so two lines evaluated either side
  // of midnight can't disagree about whether an instalment has fallen due.
  const today = todayISO();

  let lines: EffectiveFeeLine[] = [];
  if (className) {
    let structuresQuery = admin
      .from("fee_structures")
      .select("*")
      .eq("class_name", className)
      .eq("is_active", true);
    if (academicYearId) {
      structuresQuery = structuresQuery.eq("academic_year_id", academicYearId);
    }
    const [
      { data: structuresData, error: structuresError },
      { data: stopFeeData, error: stopFeeError },
    ] = await Promise.all([
      structuresQuery,
      hasTransport && busStopId && academicYearId
        ? admin
            .from("bus_stop_fees")
            .select("bus_stop_id, amount, frequency, is_active, bus_stops(name)")
            .eq("academic_year_id", academicYearId)
            .eq("bus_stop_id", busStopId)
        : Promise.resolve({ data: [], error: null }),
    ]);
    if (structuresError) {
      throw new Error(`Failed to load fee structures for dues: ${structuresError.message}`);
    }
    if (stopFeeError) {
      throw new Error(`Failed to load bus stop fees for dues: ${stopFeeError.message}`);
    }
    const stopFees: StopFeeLookup[] = ((stopFeeData as unknown[]) ?? []).map(
      (r) => {
        const row = r as {
          bus_stop_id: string;
          amount: number | string;
          frequency: string;
          is_active: boolean;
          bus_stops: { name: string } | null;
        };
        return {
          bus_stop_id: row.bus_stop_id,
          stop_name: row.bus_stops?.name ?? "",
          amount: row.amount,
          frequency: row.frequency,
          is_active: row.is_active,
        };
      }
    );
    lines = resolveEffectiveFeeLines({
      structures: (structuresData as FeeStructure[]) ?? [],
      studentStreamId: streamId,
      studentType,
      hasTransport,
      busStopId,
      direction,
      feeOverride,
      stopFees,
    });
  }

  // Scope receipts to the enrollment's year, exactly as both fee screens do.
  // Fee structures are year-scoped, so letting a prior year's receipts settle
  // this year's lines under-reports dues and opens the gate for a student who
  // genuinely owes money.
  let paymentsQuery = admin
    .from("fee_payments")
    .select(
      "fee_structure_id, amount_paid, waiver_amount, refund_amount, status"
    )
    .eq("student_id", studentId);
  if (academicYearId) {
    paymentsQuery = paymentsQuery.eq("academic_year_id", academicYearId);
  }
  const { data: paymentData, error: paymentError } = await paymentsQuery;

  if (paymentError) {
    throw new Error(`Failed to load fee payments for dues: ${paymentError.message}`);
  }

  // 'refunded' is a receipt-bearing status: a partially-refunded payment keeps
  // it with amount_paid intact, and settledAmount() (inside the breakdown)
  // nets refund_amount out per row. Dropping those rows would erase the whole
  // receipt; keeping them without netting would credit money already returned.
  const receipts =
    (paymentData as (DuesPaymentRow & { status: string })[] | null) ?? [];
  const payments = receipts.filter(
    (p) =>
      p.status === "paid" || p.status === "partial" || p.status === "refunded"
  );

  // A student who has left stops being billed on their leaving date. Without
  // this the gate would keep raising instalments against a child who is no
  // longer on the roll — and their sibling's admit card, or their own pending
  // report card, would be held back over a fee nobody intends to collect.
  const dues = computeDuesBreakdown({
    lines,
    payments,
    today,
    yearStartDate: year?.start_date,
    billingCutoff: resolveBillingCutoff(enrollment),
  });

  // The shared figure minus the one term the gate deliberately omits. Late
  // fees are additive in computeDuesBreakdown and are zeroed there once the
  // billed amount is covered, so this can't go negative.
  const pending = dues.dues - dues.lateFee;
  // Treat sub-rupee remainders as settled to avoid floating-point false blocks.
  return { total: Math.round(pending), hasOutstanding: pending >= 1 };
}
