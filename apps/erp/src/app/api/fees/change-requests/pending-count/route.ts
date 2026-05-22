import { NextResponse } from "next/server";
import { verifyAdminOrEditorWithUser } from "@nkps/shared/lib/verify-admin";

// GET /api/fees/change-requests/pending-count
//   Cheap count for the sidebar badge. Returns admin's full-queue count;
//   editors get their own pending count (so they can see how many of
//   their own requests are awaiting review).
export async function GET() {
  const auth = await verifyAdminOrEditorWithUser("fees");
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { admin, user, role } = auth;

  let query = admin
    .from("fee_change_requests")
    .select("id", { count: "exact", head: true })
    .eq("status", "pending");

  if (role === "editor") {
    query = query.eq("requested_by", user.id);
  }

  const { count, error } = await query;
  if (error) {
    console.error("[fee-change-requests.pending-count]", error);
    return NextResponse.json({ count: 0 });
  }
  return NextResponse.json({ count: count ?? 0 });
}
