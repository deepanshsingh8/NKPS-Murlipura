import { NextResponse } from "next/server";
import { verifyAdminOrEditorWithUser } from "@nkps/shared/lib/verify-admin";
import { feeWaiverSchema } from "@nkps/shared/lib/validations";
import { validateWaiver, buildWaiverRow } from "@/lib/fee-waiver";

// POST /api/fees/waivers
// Records a fee waiver as a fee_payments row with payment_method='waiver',
// amount_paid=0, waiver_amount=<requested>, status='paid'. Counts toward
// "no dues" the same way a real receipt does, but the row is unmistakably
// distinguished by payment_method='waiver' for audit/reporting.
//
// A waiver clears dues exactly like a refund reverses a payment, so the same
// privilege rule applies: admins record directly; editors must file a change
// request (action='insert') for an admin to approve. Both paths enforce the
// cap (≤ outstanding) and dedup (one active waiver per student/structure/month)
// via validateWaiver.
export async function POST(request: Request) {
  const auth = await verifyAdminOrEditorWithUser("fees");
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { admin, user, role } = auth;

  const body = await request.json();
  const parsed = feeWaiverSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid data", details: parsed.error.flatten() },
      { status: 400 }
    );
  }
  const { student_id, fee_structure_id, waiver_amount, waiver_reason, month } =
    parsed.data;

  const check = await validateWaiver(admin, {
    student_id,
    fee_structure_id,
    waiver_amount,
    waiver_reason,
    month,
  });
  if (!check.ok) {
    return NextResponse.json({ error: check.error }, { status: 400 });
  }

  const waiverRow = buildWaiverRow(
    { student_id, fee_structure_id, waiver_amount, waiver_reason, month },
    check.academic_year_id!,
    user.id
  );

  // Editors can't clear dues directly — file an insert change request instead.
  if (role === "editor") {
    const { error: reqErr } = await admin.from("fee_change_requests").insert({
      target_table: "fee_payments",
      target_id: null,
      action: "insert",
      current_snapshot: null,
      proposed_changes: waiverRow,
      reason: `Waiver: ${waiver_reason}`,
      requested_by: user.id,
    });
    if (reqErr) {
      console.error("[fees.waivers.POST] change-request insert:", reqErr);
      return NextResponse.json(
        { error: "Failed to file waiver change request" },
        { status: 500 }
      );
    }
    return NextResponse.json({
      success: true,
      pending: true,
      message: "Waiver submitted for admin approval.",
    });
  }

  const { data: payment, error } = await admin
    .from("fee_payments")
    .insert(waiverRow)
    .select()
    .single();

  if (error) {
    console.error("[fees.waivers.POST] insert:", error);
    return NextResponse.json(
      { error: "Failed to record waiver" },
      { status: 500 }
    );
  }
  return NextResponse.json({ success: true, payment });
}
