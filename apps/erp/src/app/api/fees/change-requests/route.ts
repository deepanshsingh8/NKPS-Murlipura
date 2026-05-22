import { NextRequest, NextResponse } from "next/server";
import { verifyAdminOrEditorWithUser } from "@nkps/shared/lib/verify-admin";
import { feeChangeRequestSchema } from "@nkps/shared/lib/validations";

// GET /api/fees/change-requests
//   List change requests. Query params:
//     ?status=pending|approved|rejected|cancelled  (optional, comma-separated)
//     ?mine=1                                       (editor's own only)
//   Admins see all by default; editors only ever see their own (the
//   `mine=1` flag is implied for non-admin callers regardless).
export async function GET(request: NextRequest) {
  const auth = await verifyAdminOrEditorWithUser("fees");
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { admin, user, role } = auth;

  const url = new URL(request.url);
  const statusFilter = url.searchParams.get("status");
  const mineOnly = url.searchParams.get("mine") === "1" || role === "editor";

  let query = admin
    .from("fee_change_requests")
    .select(
      "id, target_table, target_id, action, current_snapshot, proposed_changes, reason, status, requested_by, requested_at, reviewed_by, reviewed_at, review_notes"
    )
    .order("requested_at", { ascending: false });

  if (statusFilter) {
    const values = statusFilter
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (values.length === 1) query = query.eq("status", values[0]);
    else if (values.length > 1) query = query.in("status", values);
  }
  if (mineOnly) query = query.eq("requested_by", user.id);

  const { data: requests, error } = await query;
  if (error) {
    console.error("[fee-change-requests.list]", error);
    return NextResponse.json({ error: "Failed to load requests" }, { status: 500 });
  }

  // Resolve actor names in one round-trip so the UI doesn't render UUIDs.
  // (Memory: never display UUIDs in the UI.)
  const actorIds = new Set<string>();
  for (const r of requests ?? []) {
    if (r.requested_by) actorIds.add(r.requested_by);
    if (r.reviewed_by) actorIds.add(r.reviewed_by);
  }
  const { data: profiles } = actorIds.size
    ? await admin
        .from("profiles")
        .select("id, full_name, email")
        .in("id", Array.from(actorIds))
    : { data: [] as Array<{ id: string; full_name: string | null; email: string | null }> };
  const nameById = new Map<string, string>();
  for (const p of profiles ?? []) {
    nameById.set(p.id, p.full_name ?? p.email ?? "Unknown");
  }

  const enriched = (requests ?? []).map((r) => ({
    ...r,
    requested_by_name: r.requested_by ? nameById.get(r.requested_by) ?? null : null,
    reviewed_by_name: r.reviewed_by ? nameById.get(r.reviewed_by) ?? null : null,
  }));

  return NextResponse.json({ requests: enriched });
}

// POST /api/fees/change-requests
//   Editor (or admin) files a change request for a recorded fee_payments row.
//   The current row is snapshotted server-side so the editor cannot lie
//   about what they're proposing to change FROM.
export async function POST(request: NextRequest) {
  const auth = await verifyAdminOrEditorWithUser("fees");
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { admin, user } = auth;

  const body = await request.json();
  const parsed = feeChangeRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request", details: parsed.error.flatten() },
      { status: 400 }
    );
  }
  const { target_table, target_id, action, proposed_changes, reason } = parsed.data;

  // Snapshot the row as-is at request time. The approve step compares this
  // snapshot to the live row to detect drift (someone else changed the
  // record between request and approval).
  const { data: row, error: lookupErr } = await admin
    .from(target_table)
    .select("*")
    .eq("id", target_id)
    .maybeSingle();
  if (lookupErr) {
    console.error("[fee-change-requests.create] lookup:", lookupErr);
    return NextResponse.json({ error: "Failed to load target row" }, { status: 500 });
  }
  if (!row) {
    return NextResponse.json({ error: "Target record not found" }, { status: 404 });
  }

  const { data: created, error: insertErr } = await admin
    .from("fee_change_requests")
    .insert({
      target_table,
      target_id,
      action,
      current_snapshot: row,
      proposed_changes: action === "delete" ? {} : proposed_changes,
      reason,
      requested_by: user.id,
    })
    .select()
    .single();

  if (insertErr) {
    // 23505 = unique violation on idx_fee_change_requests_one_pending.
    // Surface a clean message instead of a generic 500.
    if (insertErr.code === "23505") {
      return NextResponse.json(
        {
          error:
            "A change request is already pending for this record. Wait for it to be reviewed before filing another.",
        },
        { status: 409 }
      );
    }
    console.error("[fee-change-requests.create] insert:", insertErr);
    return NextResponse.json(
      { error: "Failed to file change request" },
      { status: 500 }
    );
  }

  return NextResponse.json({ success: true, request: created });
}
