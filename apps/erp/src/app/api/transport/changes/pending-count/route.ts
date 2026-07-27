import { NextResponse } from "next/server";
import { verifyAdminOrEditorWithUser } from "@nkps/shared/lib/verify-admin";

// GET /api/transport/changes/pending-count
//   Cheap count for the sidebar badge — parent/office-submitted change
//   requests still awaiting review.
export async function GET() {
  const auth = await verifyAdminOrEditorWithUser("transport");
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { admin } = auth;

  const { count, error } = await admin
    .from("transport_change_requests")
    .select("id", { count: "exact", head: true })
    .eq("status", "pending");

  if (error) {
    console.error("[transport-changes.pending-count]", error);
    return NextResponse.json({ count: 0 });
  }
  return NextResponse.json({ count: count ?? 0 });
}
