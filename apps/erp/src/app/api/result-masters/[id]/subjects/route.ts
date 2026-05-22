import { NextRequest, NextResponse } from "next/server";
import { verifyAdmin } from "@nkps/shared/lib/verify-admin";
import { resultMasterSubjectsPutSchema } from "@nkps/shared/lib/validations";

type RouteContext = { params: Promise<{ id: string }> };

// PUT /api/result-masters/[id]/subjects
// Wholesale replace the subjects list. Supabase JS has no native transactions;
// we stage the insert rows first, delete the old, then insert. If insert fails
// we surface a clear error — the master is left subject-less (caller should
// retry). This matches grade_scales band-replacement semantics.
export async function PUT(request: NextRequest, context: RouteContext) {
  const admin = await verifyAdmin();
  if (!admin) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await context.params;

  // Confirm master exists before we blow away any children.
  const { data: master } = await admin
    .from("result_masters")
    .select("id")
    .eq("id", id)
    .maybeSingle();
  if (!master) {
    return NextResponse.json({ error: "Result master not found" }, { status: 404 });
  }

  const body = await request.json();
  const parsed = resultMasterSubjectsPutSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid data", details: parsed.error.flatten() },
      { status: 400 }
    );
  }
  const { subjects } = parsed.data;

  // Dedupe check — UNIQUE(result_master_id, subject_id) on the DB, but we
  // want a nicer 400 than the raw 23505 error.
  const seen = new Set<string>();
  const dupes: string[] = [];
  for (const s of subjects) {
    if (seen.has(s.subject_id)) dupes.push(s.subject_id);
    seen.add(s.subject_id);
  }
  if (dupes.length > 0) {
    return NextResponse.json(
      {
        error: `Duplicate subject_id in payload: ${dupes.join(", ")}`,
        code: "DUPLICATE_SUBJECT",
      },
      { status: 400 }
    );
  }

  const rows = subjects.map((s) => ({
    result_master_id: id,
    subject_id: s.subject_id,
    role: s.role,
    pass_mark_value_override: s.pass_mark_value_override,
    sort_order: s.sort_order,
  }));

  // Delete-then-insert. If insert fails we return the error; the master is
  // left with no subjects until the caller retries.
  const { error: delErr } = await admin
    .from("result_master_subjects")
    .delete()
    .eq("result_master_id", id);
  if (delErr) {
    console.error("[result-master-subjects.PUT] delete:", delErr);
    return NextResponse.json({ error: "Failed to update subjects" }, { status: 500 });
  }

  if (rows.length === 0) {
    return NextResponse.json({ data: [] });
  }

  const { data: inserted, error: insErr } = await admin
    .from("result_master_subjects")
    .insert(rows)
    .select(
      "id, result_master_id, subject_id, role, pass_mark_value_override, sort_order, created_at"
    )
    .order("sort_order", { ascending: true });
  if (insErr) {
    console.error("[result-master-subjects.PUT] insert after delete:", insErr);
    return NextResponse.json(
      {
        error: "Subjects insert failed after delete; master is now subject-less.",
        code: "SUBJECTS_INSERT_FAILED",
      },
      { status: 500 }
    );
  }

  return NextResponse.json({ data: inserted ?? [] });
}
