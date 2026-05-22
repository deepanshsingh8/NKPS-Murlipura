// POST /api/results/historical-revert
//
// Admin-only revert of a results historical-import batch. Mirrors the fees
// revert endpoint with adjusted guards:
//   • Block revert if any row in the batch is referenced by a published
//     marksheet (marksheet_publications.batch — see migration-041). The
//     parent has already seen those marks; silently deleting would corrupt
//     a published artifact.

import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { createAdminClient } from "@nkps/shared/lib/supabase/admin";

export async function POST(req: NextRequest) {
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
  const { data: profile } = await admin
    .from("profiles")
    .select("role, must_change_password")
    .eq("id", userData.user.id)
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

  const { data: rows, error: rowsErr } = await admin
    .from("results")
    .select("id, student_id, class_id, exam_type_id, is_published")
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

  // Guard: block if any row was included in a marksheet publication.
  // marksheet_publications stores its batch in `result_ids text[]` (per
  // migration 041); we look for any publication intersecting our row IDs.
  const rowIds = rows.map((r) => r.id as string);
  let publishedCount = 0;
  for (let i = 0; i < rowIds.length; i += 200) {
    const chunk = rowIds.slice(i, i + 200);
    const { count, error } = await admin
      .from("marksheet_publications")
      .select("id", { count: "exact", head: true })
      .overlaps("result_ids", chunk);
    if (error) {
      // marksheet_publications may not exist in all envs — log and continue.
      // The .overlaps will return PGRST116 if the column is missing. Be
      // conservative on real errors.
      if (!String(error.code ?? "").startsWith("PGRST")) {
        return NextResponse.json({ error: error.message }, { status: 500 });
      }
    } else {
      publishedCount += count ?? 0;
    }
  }
  if (publishedCount > 0) {
    return NextResponse.json(
      {
        error: `Cannot revert: ${publishedCount} marksheet publication(s) reference results in this batch. Unpublish them first.`,
        publication_count: publishedCount,
      },
      { status: 409 }
    );
  }

  const { error: delErr, count } = await admin
    .from("results")
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
