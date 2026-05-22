import { NextRequest, NextResponse } from "next/server";
import { verifyAdminWithUser } from "@nkps/shared/lib/verify-admin";
import { feeChangeRequestReviewSchema } from "@nkps/shared/lib/validations";

interface RouteContext {
  params: Promise<{ id: string }>;
}

// POST /api/fees/change-requests/[id]/reject
//   Admin-only. Atomic flip pending → rejected with optional review notes.
//   No DB side-effects on the target row. The requester sees the rejection
//   in their own request list.
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

  const { data: updated, error: updErr } = await admin
    .from("fee_change_requests")
    .update({
      status: "rejected",
      reviewed_by: user.id,
      reviewed_at: new Date().toISOString(),
      review_notes: review_notes || null,
    })
    .eq("id", id)
    .eq("status", "pending")
    .select("id")
    .maybeSingle();

  if (updErr) {
    console.error("[fee-change-requests.reject]", updErr);
    return NextResponse.json(
      { error: "Failed to reject request" },
      { status: 500 }
    );
  }
  if (!updated) {
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

  return NextResponse.json({ success: true, id });
}
