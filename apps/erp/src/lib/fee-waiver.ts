import type { SupabaseClient } from "@supabase/supabase-js";
import { generateReceiptNumber } from "@nkps/shared/lib/password";
import { annualizedAmount } from "./fees";

// Shared waiver logic so the direct (admin) insert and the change-request
// (editor → admin approval) path enforce the SAME guards:
//   • cap   — a waiver may not exceed the fee still owed on that structure
//   • dedup — one active waiver per (student, structure, month)
// Both run server-side against the service-role client.

export interface WaiverInput {
  student_id: string;
  fee_structure_id: string;
  waiver_amount: number;
  waiver_reason: string;
  month?: string | null;
}

export interface WaiverValidation {
  ok: boolean;
  error?: string;
  academic_year_id?: string;
}

// Validates a proposed waiver against the live ledger. Re-run at apply time
// (not just request time) so a waiver can't slip past after the student has
// since paid or another waiver landed.
export async function validateWaiver(
  admin: SupabaseClient,
  input: WaiverInput
): Promise<WaiverValidation> {
  const { student_id, fee_structure_id, waiver_amount, month } = input;

  if (!Number.isFinite(waiver_amount) || waiver_amount <= 0) {
    return { ok: false, error: "Waiver amount must be a positive number." };
  }

  const { data: structure, error: structErr } = await admin
    .from("fee_structures")
    .select("amount, frequency, academic_year_id")
    .eq("id", fee_structure_id)
    .maybeSingle();
  if (structErr) {
    return { ok: false, error: "Failed to load fee structure." };
  }
  if (!structure) {
    return { ok: false, error: "Fee structure not found." };
  }

  // All settled payments + waivers against this structure. Refunded rows are
  // pulled too: a partial refund keeps amount_paid intact, so its net cash
  // (`amount_paid - refund_amount`) still counts toward the cap below.
  const { data: payments, error: payErr } = await admin
    .from("fee_payments")
    .select("amount_paid, waiver_amount, refund_amount, status, payment_method, month")
    .eq("student_id", student_id)
    .eq("fee_structure_id", fee_structure_id);
  if (payErr) {
    return { ok: false, error: "Failed to load existing payments." };
  }

  const rows = payments ?? [];

  // Dedup: at most one active (non-refunded) waiver per (student, structure,
  // month). Treat a null month as its own bucket.
  const dupWaiver = rows.find(
    (p) =>
      p.payment_method === "waiver" &&
      p.status !== "refunded" &&
      (p.month ?? null) === (month ?? null)
  );
  if (dupWaiver) {
    return {
      ok: false,
      error: month
        ? `A waiver already exists for this fee and month (${month}). Edit or remove it instead of adding another.`
        : "A waiver already exists for this fee. Edit or remove it instead of adding another.",
    };
  }

  // Cap: a waiver can't clear more than is still owed on this structure.
  const obligation = annualizedAmount(structure);
  const settled = rows
    .filter(
      (p) =>
        p.status === "paid" ||
        p.status === "partial" ||
        p.status === "refunded"
    )
    .reduce(
      (sum, p) =>
        sum +
        Math.max(0, Number(p.amount_paid) - Number(p.refund_amount ?? 0)) +
        Number(p.waiver_amount ?? 0),
      0
    );
  const remaining = obligation - settled;
  // Allow a sub-rupee tolerance for float noise.
  if (waiver_amount > remaining + 0.5) {
    return {
      ok: false,
      error: `Waiver (${waiver_amount}) exceeds the outstanding amount on this fee (${Math.max(0, Math.round(remaining))}).`,
    };
  }

  return { ok: true, academic_year_id: structure.academic_year_id as string };
}

// Builds the fee_payments row for a validated waiver. Used directly by admins
// and stored as proposed_changes for an editor's change request.
export function buildWaiverRow(
  input: WaiverInput,
  academicYearId: string,
  recordedBy: string
): Record<string, unknown> {
  return {
    student_id: input.student_id,
    fee_structure_id: input.fee_structure_id,
    academic_year_id: academicYearId,
    amount_paid: 0,
    payment_method: "waiver",
    waiver_amount: input.waiver_amount,
    waiver_reason: input.waiver_reason,
    month: input.month || null,
    receipt_number: generateReceiptNumber(),
    payment_date: new Date().toISOString().split("T")[0],
    status: "paid",
    recorded_by: recordedBy,
  };
}
