import { NextRequest, NextResponse } from "next/server";
import { verifyAdminOrEditorWithUser } from "@nkps/shared/lib/verify-admin";

interface RouteContext {
  params: Promise<{ id: string }>;
}

// GET /api/fees/change-requests/[id]
//   Returns the request plus the live target row (so the reviewer can see
//   drift between current_snapshot and the row as it actually is now).
//   Editors can only fetch their own requests.
export async function GET(_request: NextRequest, context: RouteContext) {
  const auth = await verifyAdminOrEditorWithUser("fees");
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { admin, user, role } = auth;

  const { id } = await context.params;

  const { data: req, error } = await admin
    .from("fee_change_requests")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) {
    console.error("[fee-change-requests.detail] lookup:", error);
    return NextResponse.json({ error: "Failed to load request" }, { status: 500 });
  }
  if (!req) {
    return NextResponse.json({ error: "Request not found" }, { status: 404 });
  }
  if (role === "editor" && req.requested_by !== user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Resolve actor names.
  const ids = [req.requested_by, req.reviewed_by].filter(
    (v): v is string => typeof v === "string"
  );
  const { data: profiles } = ids.length
    ? await admin.from("profiles").select("id, full_name, email").in("id", ids)
    : { data: [] as Array<{ id: string; full_name: string | null; email: string | null }> };
  const nameById = new Map<string, string>();
  for (const p of profiles ?? []) {
    nameById.set(p.id, p.full_name ?? p.email ?? "Unknown");
  }

  // Live target row — used by the UI to detect drift vs current_snapshot.
  const { data: liveRow } = await admin
    .from(req.target_table)
    .select("*")
    .eq("id", req.target_id)
    .maybeSingle();

  return NextResponse.json({
    request: {
      ...req,
      requested_by_name: req.requested_by ? nameById.get(req.requested_by) ?? null : null,
      reviewed_by_name: req.reviewed_by ? nameById.get(req.reviewed_by) ?? null : null,
    },
    live_row: liveRow ?? null,
  });
}
