import { NextRequest, NextResponse } from "next/server";
import { verifyAdminOrEditorWithUser } from "@nkps/shared/lib/verify-admin";
import { feeRefundSchema } from "@nkps/shared/lib/validations";

interface RouteContext {
  params: Promise<{ id: string }>;
}

// POST /api/fees/payments/[id]/refund
// Marks a previously-recorded payment as refunded with reason + amount.
// The DB CHECK constraint (`fee_payments_refund_consistent`) enforces that
// `refund_amount > 0` whenever status flips to 'refunded'.
//
// **Single refund per payment.** Partial-refunds are supported in the sense
// that `refund_amount` may be less than `amount_paid`, but a payment can
// only be refunded once. To split a refund across two events, record the
// surplus as a separate fee_payments row first, then refund each
// independently. (Audit M17 — UI copy was previously ambiguous.)
export async function POST(request: NextRequest, context: RouteContext) {
  const auth = await verifyAdminOrEditorWithUser("fees");
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { admin, user, role } = auth;

  const { id } = await context.params;

  // Refund mutates an existing fee_payments row, so editors must route
  // through the change-request flow. Admins refund directly.
  if (role === "editor") {
    return NextResponse.json(
      {
        error:
          "Editors cannot refund directly. File a change request for an admin to review.",
        code: "EDITOR_MUST_REQUEST",
        table: "fee_payments",
        action: "update",
        match: { column: "id", value: id },
      },
      { status: 403 }
    );
  }
  const body = await request.json();
  const parsed = feeRefundSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid data", details: parsed.error.flatten() },
      { status: 400 }
    );
  }
  const { refund_amount, refund_reason } = parsed.data;

  const { data: existing, error: lookupErr } = await admin
    .from("fee_payments")
    .select("id, amount_paid, status, payment_method")
    .eq("id", id)
    .maybeSingle();
  if (lookupErr) {
    console.error("[fees.refund] lookup:", lookupErr);
    return NextResponse.json({ error: "Failed to load payment" }, { status: 500 });
  }
  if (!existing) {
    return NextResponse.json({ error: "Payment not found" }, { status: 404 });
  }
  if (existing.status === "refunded") {
    return NextResponse.json(
      {
        error:
          "This payment is already refunded. Only one refund per payment is supported — record a follow-up payment if you need to split the refund.",
      },
      { status: 400 }
    );
  }
  if (existing.payment_method === "waiver") {
    return NextResponse.json(
      { error: "Waivers cannot be refunded — delete the waiver row instead" },
      { status: 400 }
    );
  }
  if (refund_amount > Number(existing.amount_paid)) {
    return NextResponse.json(
      {
        error: `Refund amount cannot exceed the original payment (${existing.amount_paid}).`,
      },
      { status: 400 }
    );
  }

  // Audit H6: optimistic-concurrency guard. The previous read-then-write
  // sequence let two simultaneous refund POSTs both pass the
  // `status !== "refunded"` precheck and both commit — the second silently
  // overwrote the first's reason/amount/actor. The `.eq("status",
  // existing.status)` clause makes the loser of the race affect zero rows.
  const { data: updated, error: updateErr } = await admin
    .from("fee_payments")
    .update({
      status: "refunded",
      refund_amount,
      refund_reason,
      refunded_at: new Date().toISOString(),
      refunded_by: user.id,
    })
    .eq("id", id)
    .eq("status", existing.status)
    .select("id");
  if (updateErr) {
    console.error("[fees.refund] update:", updateErr);
    return NextResponse.json({ error: "Failed to refund payment" }, { status: 500 });
  }
  if (!updated || updated.length === 0) {
    return NextResponse.json(
      {
        error:
          "Payment was modified by another request. Refresh and try again.",
      },
      { status: 409 }
    );
  }

  return NextResponse.json({ success: true, id });
}
