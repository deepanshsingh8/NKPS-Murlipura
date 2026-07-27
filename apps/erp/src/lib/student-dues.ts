import type { SupabaseClient } from "@supabase/supabase-js";
import type { FeeStructure, TransportDirection } from "@nkps/shared/types";
import {
  sumAnnualized,
  resolveEffectiveFeeLines,
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

interface PaymentRow {
  amount_paid: number | string;
  waiver_amount: number | string | null;
  status: string;
}

// Outstanding fee dues for a single student. Mirrors the student-facing fees
// page (apps/erp/src/app/student/fees/page.tsx) exactly so the gating amount
// matches the "Pending" figure the student already sees: annualized fee lines
// (academic + opted transport slab) minus cash paid + waivers granted on
// paid/partial payments. Late fees are intentionally excluded to stay
// consistent with that view. Pass a service-role client to bypass RLS.
export async function getStudentOutstandingDues(
  admin: SupabaseClient,
  studentId: string
): Promise<StudentDues> {
  const { data: enrollment, error: enrollmentError } = await admin
    .from("student_enrollments")
    .select(
      "class_id, stream_id, academic_year_id, has_transport, bus_stop_id, transport_direction, transport_fee_override, classes(name)"
    )
    .eq("student_id", studentId)
    .order("enrollment_date", { ascending: false })
    .limit(1)
    .maybeSingle();

  // Never swallow a DB error here: a silent failure would make totalPaid or
  // totalFees default to 0, which either falsely blocks a paid-up student from
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

  let totalFees = 0;
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
    const lines = resolveEffectiveFeeLines({
      structures: (structuresData as FeeStructure[]) ?? [],
      studentStreamId: streamId,
      hasTransport,
      busStopId,
      direction,
      feeOverride,
      stopFees,
    });
    totalFees = sumAnnualized(lines);
  }

  const { data: paymentData, error: paymentError } = await admin
    .from("fee_payments")
    .select("amount_paid, waiver_amount, status")
    .eq("student_id", studentId);

  if (paymentError) {
    throw new Error(`Failed to load fee payments for dues: ${paymentError.message}`);
  }

  const totalPaid = ((paymentData as PaymentRow[]) ?? [])
    .filter((p) => p.status === "paid" || p.status === "partial")
    .reduce(
      (sum, p) => sum + Number(p.amount_paid) + Number(p.waiver_amount ?? 0),
      0
    );

  const pending = Math.max(0, totalFees - totalPaid);
  // Treat sub-rupee remainders as settled to avoid floating-point false blocks.
  return { total: Math.round(pending), hasOutstanding: pending >= 1 };
}
