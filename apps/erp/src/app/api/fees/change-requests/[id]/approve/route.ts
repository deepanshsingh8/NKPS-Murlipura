import { NextRequest, NextResponse } from "next/server";
import { verifyAdminWithUser } from "@nkps/shared/lib/verify-admin";
import { feeChangeRequestReviewSchema } from "@nkps/shared/lib/validations";

interface RouteContext {
  params: Promise<{ id: string }>;
}

// Columns on fee_payments that an approved change request may modify.
// Anything outside this set is silently dropped — student_id, receipt
// numbers, FK references, etc. are not editable through this flow (a
// wholly wrong row should be deleted and re-recorded instead).
const FEE_PAYMENT_EDITABLE_COLUMNS = new Set<string>([
  "amount_paid",
  "status",
  "payment_method",
  "cheque_number",
  "cheque_date",
  "bank_name",
  "payer_name",
  "transaction_ref",
  "payment_provider",
  "month",
  "remarks",
  "refund_amount",
  "refund_reason",
]);

// POST /api/fees/change-requests/[id]/approve
//   Admin-only. Atomically:
//     1. Claims the pending request (flips status → approved).
//     2. Re-reads the live target row (snapshot for the audit log).
//     3. Applies proposed_changes (or deletes the row for action='delete').
//     4. Writes a fee_change_audit_log row.
//   If the apply step fails the request is reverted to 'pending' so an
//   admin can retry — same pattern as the registration approval flow.
export async function POST(request: NextRequest, context: RouteContext) {
  const auth = await verifyAdminWithUser();
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { admin, user } = auth;

  const { id } = await context.params;
  const body = await request.json().catch(() => ({}));
  const parsed = feeChangeRequestReviewSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid review payload", details: parsed.error.flatten() },
      { status: 400 }
    );
  }
  const { review_notes } = parsed.data;

  // Atomic claim — flips pending → approved and returns the row that was
  // actually modified. Two admins clicking "approve" simultaneously: only
  // one gets a row back; the loser bails out at the 'no row' branch.
  const reviewedAt = new Date().toISOString();
  const { data: claimed, error: claimErr } = await admin
    .from("fee_change_requests")
    .update({
      status: "approved",
      reviewed_by: user.id,
      reviewed_at: reviewedAt,
      review_notes: review_notes || null,
    })
    .eq("id", id)
    .eq("status", "pending")
    .select("*")
    .maybeSingle();

  if (claimErr) {
    console.error("[fee-change-requests.approve] claim:", claimErr);
    return NextResponse.json(
      { error: "Failed to claim request" },
      { status: 500 }
    );
  }
  if (!claimed) {
    const { data: existing } = await admin
      .from("fee_change_requests")
      .select("status")
      .eq("id", id)
      .maybeSingle();
    if (!existing) {
      return NextResponse.json({ error: "Request not found" }, { status: 404 });
    }
    return NextResponse.json(
      { error: `This request is already ${existing.status}` },
      { status: 409 }
    );
  }

  // Helper to revert the request to pending if the apply step fails. The
  // request is stranded as 'approved' otherwise — no underlying change,
  // misleading audit trail.
  const revert = async (reason: string) => {
    await admin
      .from("fee_change_requests")
      .update({
        status: "pending",
        reviewed_by: null,
        reviewed_at: null,
        review_notes: null,
      })
      .eq("id", id);
    console.error(`[fee-change-requests.approve] reverted: ${reason}`);
  };

  // Snapshot the live row for the audit log (and to detect drift).
  const { data: liveRow, error: liveErr } = await admin
    .from(claimed.target_table)
    .select("*")
    .eq("id", claimed.target_id)
    .maybeSingle();
  if (liveErr) {
    await revert("live-row lookup failed");
    return NextResponse.json(
      { error: "Failed to load target row for approval" },
      { status: 500 }
    );
  }
  if (!liveRow) {
    await revert("target row gone");
    return NextResponse.json(
      {
        error:
          "The target record no longer exists. Reject this request and inform the requester.",
      },
      { status: 409 }
    );
  }

  // Apply the change.
  if (claimed.action === "delete") {
    const { error: delErr } = await admin
      .from(claimed.target_table)
      .delete()
      .eq("id", claimed.target_id);
    if (delErr) {
      await revert(`delete failed: ${delErr.message}`);
      // FK violation: payments referenced elsewhere. Tell the admin
      // exactly why so they can decide whether to reject the request.
      if (
        delErr.code === "23503" ||
        /foreign key/i.test(delErr.message ?? "")
      ) {
        return NextResponse.json(
          {
            error:
              "Cannot delete: other records reference this row. Reject the request or remove the dependents first.",
          },
          { status: 409 }
        );
      }
      return NextResponse.json(
        { error: "Failed to apply delete. Request reverted to pending." },
        { status: 500 }
      );
    }
  } else {
    // action === 'update'. Filter proposed_changes to the editable set.
    const proposed = (claimed.proposed_changes ?? {}) as Record<string, unknown>;
    const patch: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(proposed)) {
      if (FEE_PAYMENT_EDITABLE_COLUMNS.has(k)) patch[k] = v;
    }

    // Basic safety rails. The reviewer is responsible for verifying the
    // amount makes sense; we only block the obvious garbage.
    if ("amount_paid" in patch) {
      const amt = Number(patch.amount_paid);
      if (!Number.isFinite(amt) || amt < 0) {
        await revert("invalid amount_paid");
        return NextResponse.json(
          { error: "Proposed amount_paid is not a valid number." },
          { status: 400 }
        );
      }
    }
    if ("status" in patch) {
      const s = String(patch.status);
      if (!["paid", "partial", "refunded"].includes(s)) {
        await revert("invalid status");
        return NextResponse.json(
          { error: "Proposed status must be paid, partial, or refunded." },
          { status: 400 }
        );
      }
      // Refund consistency: when flipping to 'refunded', require
      // refund_amount + reason, and stamp refunded_at/refunded_by from
      // the approving admin.
      if (s === "refunded") {
        const refundAmt = Number(patch.refund_amount ?? liveRow.refund_amount);
        if (!Number.isFinite(refundAmt) || refundAmt <= 0) {
          await revert("missing refund_amount");
          return NextResponse.json(
            { error: "Refund requires a positive refund_amount." },
            { status: 400 }
          );
        }
        const reason = String(patch.refund_reason ?? liveRow.refund_reason ?? "");
        if (reason.trim().length < 5) {
          await revert("missing refund_reason");
          return NextResponse.json(
            { error: "Refund requires a reason (min 5 chars)." },
            { status: 400 }
          );
        }
        patch.refunded_at = reviewedAt;
        patch.refunded_by = user.id;
      }
    }

    if (Object.keys(patch).length === 0) {
      await revert("no editable columns in proposed_changes");
      return NextResponse.json(
        { error: "No editable columns were specified in the request." },
        { status: 400 }
      );
    }

    const { error: updErr } = await admin
      .from(claimed.target_table)
      .update(patch)
      .eq("id", claimed.target_id);

    if (updErr) {
      await revert(`update failed: ${updErr.message}`);
      return NextResponse.json(
        { error: "Failed to apply update. Request reverted to pending." },
        { status: 500 }
      );
    }
  }

  // Re-read after the apply for the audit log.
  const { data: afterRow } =
    claimed.action === "delete"
      ? { data: null }
      : await admin
          .from(claimed.target_table)
          .select("*")
          .eq("id", claimed.target_id)
          .maybeSingle();

  const { error: auditErr } = await admin
    .from("fee_change_audit_log")
    .insert({
      target_table: claimed.target_table,
      target_id: claimed.target_id,
      action: claimed.action,
      before_snapshot: liveRow,
      after_snapshot: afterRow,
      performed_by: user.id,
      source_request_id: claimed.id,
      notes: review_notes || null,
    });
  // Audit log failure does not undo the change — the change is real and
  // the user-facing flow already succeeded. Log it loud so we notice.
  if (auditErr) {
    console.error(
      `[fee-change-requests.approve] audit insert failed for request ${id}:`,
      auditErr
    );
  }

  return NextResponse.json({ success: true, id: claimed.id });
}
