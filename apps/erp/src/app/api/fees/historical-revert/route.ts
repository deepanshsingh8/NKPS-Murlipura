// POST /api/fees/historical-revert
//
// Deletes every fee_payments row tagged with a given import_batch_id and
// source='historical_import'. Admin-only — editors cannot revert imports
// even if they hold the "fees" feature permission, because a bad revert
// destroys data permanently.
//
// Guards:
//   • caller's profile.role must be 'admin'
//   • body.batch_id must be a UUID
//   • body.confirm_batch_id must match — type-the-id confirmation prevents
//     fat-finger reverts of the wrong batch
//   • Block revert if any row in the batch has a downstream artifact:
//       - any later non-historical payment from the same student for the
//         same fee_structure (the original import has been "built on")
//       - any row with status='refunded' (refund flow already touched it)

import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { createAdminClient } from "@nkps/shared/lib/supabase/admin";

export async function POST(req: NextRequest) {
  // Admin-only auth. Read the bearer token + verify role='admin' inline so
  // editors with the 'fees' feature flag can't revert.
  const headerList = await headers();
  const authHeader = headerList.get("authorization") ?? "";
  const token = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!token) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const admin = createAdminClient();
  const { data: userData, error: userErr } = await admin.auth.getUser(token);
  if (userErr || !userData?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = userData.user.id;
  const { data: profile } = await admin
    .from("profiles")
    .select("role, must_change_password")
    .eq("id", userId)
    .maybeSingle();
  if (!profile || profile.must_change_password || profile.role !== "admin") {
    return NextResponse.json(
      { error: "Forbidden — admin role required to revert imports" },
      { status: 403 }
    );
  }

  let body: { batch_id?: string; confirm_batch_id?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Expected JSON body" }, { status: 400 });
  }
  const batchId = body.batch_id?.trim();
  const confirmId = body.confirm_batch_id?.trim();
  if (!batchId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(batchId)) {
    return NextResponse.json({ error: "batch_id must be a UUID" }, { status: 400 });
  }
  if (confirmId !== batchId) {
    return NextResponse.json(
      { error: "confirm_batch_id must match batch_id (type-to-confirm)" },
      { status: 400 }
    );
  }

  // Look up the batch — confirm at least one row exists.
  const { data: rows, error: rowsErr } = await admin
    .from("fee_payments")
    .select("id, student_id, fee_structure_id, status, amount_paid")
    .eq("import_batch_id", batchId)
    .eq("source", "historical_import");
  if (rowsErr) {
    return NextResponse.json({ error: rowsErr.message }, { status: 500 });
  }
  if (!rows || rows.length === 0) {
    return NextResponse.json(
      { error: `No historical-import rows found for batch ${batchId}` },
      { status: 404 }
    );
  }

  // Guard: any row in this batch already refunded?
  const refunded = rows.filter((r) => r.status === "refunded");
  if (refunded.length > 0) {
    return NextResponse.json(
      {
        error: `Cannot revert: ${refunded.length} row(s) in this batch have status='refunded'. Resolve those manually before reverting.`,
        refunded_count: refunded.length,
      },
      { status: 409 }
    );
  }

  // Guard: has any (student_id, fee_structure_id) in this batch received a
  // follow-up native payment? That would indicate downstream work has been
  // built on the imported rows.
  const pairs = new Map<string, { student_id: string; fee_structure_id: string }>();
  for (const r of rows) {
    if (r.fee_structure_id) {
      const k = `${r.student_id}::${r.fee_structure_id}`;
      pairs.set(k, { student_id: r.student_id, fee_structure_id: r.fee_structure_id });
    }
  }
  const followups: number = await countFollowupNativePayments(admin, [...pairs.values()]);
  if (followups > 0) {
    return NextResponse.json(
      {
        error: `Cannot revert: ${followups} native (non-imported) payment(s) exist for students/structures in this batch. Reverting would orphan those follow-up payments. Delete them first if intentional.`,
        followups,
      },
      { status: 409 }
    );
  }

  // Delete the rows.
  const { error: delErr, count } = await admin
    .from("fee_payments")
    .delete({ count: "exact" })
    .eq("import_batch_id", batchId)
    .eq("source", "historical_import");
  if (delErr) {
    return NextResponse.json({ error: delErr.message }, { status: 500 });
  }

  return NextResponse.json({
    success: true,
    deleted: count ?? rows.length,
    batch_id: batchId,
  });
}

async function countFollowupNativePayments(
  admin: ReturnType<typeof createAdminClient>,
  pairs: Array<{ student_id: string; fee_structure_id: string }>
): Promise<number> {
  if (pairs.length === 0) return 0;
  // Postgres caps `IN (…)` lists. Batch the lookup.
  let total = 0;
  for (let i = 0; i < pairs.length; i += 100) {
    const chunk = pairs.slice(i, i + 100);
    const studentIds = [...new Set(chunk.map((p) => p.student_id))];
    const structureIds = [...new Set(chunk.map((p) => p.fee_structure_id))];
    const { count, error } = await admin
      .from("fee_payments")
      .select("id", { count: "exact", head: true })
      .in("student_id", studentIds)
      .in("fee_structure_id", structureIds)
      .eq("source", "erp_native");
    if (error) {
      // Be conservative: treat lookup errors as a block.
      return Number.POSITIVE_INFINITY;
    }
    total += count ?? 0;
  }
  return total;
}
