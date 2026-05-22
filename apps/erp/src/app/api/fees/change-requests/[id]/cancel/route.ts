import { NextRequest, NextResponse } from "next/server";
import { verifyAdminOrEditorWithUser } from "@nkps/shared/lib/verify-admin";

interface RouteContext {
  params: Promise<{ id: string }>;
}

// POST /api/fees/change-requests/[id]/cancel
//   Original requester can withdraw their own pending request. Admins can
//   cancel any pending request. Approved/rejected/cancelled rows are
//   immutable.
export async function POST(_request: NextRequest, context: RouteContext) {
  const auth = await verifyAdminOrEditorWithUser("fees");
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { admin, user, role } = auth;

  const { id } = await context.params;

  const { data: existing, error: lookupErr } = await admin
    .from("fee_change_requests")
    .select("requested_by, status")
    .eq("id", id)
    .maybeSingle();
  if (lookupErr) {
    console.error("[fee-change-requests.cancel] lookup:", lookupErr);
    return NextResponse.json(
      { error: "Failed to load request" },
      { status: 500 }
    );
  }
  if (!existing) {
    return NextResponse.json({ error: "Request not found" }, { status: 404 });
  }
  if (existing.status !== "pending") {
    return NextResponse.json(
      { error: `Cannot cancel a request that is already ${existing.status}` },
      { status: 409 }
    );
  }
  if (role === "editor" && existing.requested_by !== user.id) {
    return NextResponse.json(
      { error: "You can only cancel your own requests" },
      { status: 403 }
    );
  }

  const { data: cancelled, error: updErr } = await admin
    .from("fee_change_requests")
    .update({
      status: "cancelled",
      reviewed_by: user.id,
      reviewed_at: new Date().toISOString(),
    })
    .eq("id", id)
    .eq("status", "pending")
    .select("id")
    .maybeSingle();
  if (updErr) {
    console.error("[fee-change-requests.cancel] update:", updErr);
    return NextResponse.json(
      { error: "Failed to cancel request" },
      { status: 500 }
    );
  }
  if (!cancelled) {
    return NextResponse.json(
      { error: "Request was modified concurrently. Refresh and try again." },
      { status: 409 }
    );
  }

  return NextResponse.json({ success: true, id });
}
