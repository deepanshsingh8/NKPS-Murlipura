import { NextRequest, NextResponse } from "next/server";
import { verifyAdmin } from "@nkps/shared/lib/verify-admin";
import { resultMasterExamConfigsPutSchema } from "@nkps/shared/lib/validations";

type RouteContext = { params: Promise<{ id: string }> };

// PUT /api/result-masters/[id]/exam-configs
// Upsert class_exam_configs for the master's class scoped to the master's
// academic year. Rows for OTHER academic years' exam_types are left untouched
// — critical, since a class carries weightages across multiple years.
//
// Payload is the complete set of rows for the master's academic year. We:
//   1. Upsert all provided rows on (class_id, exam_type_id).
//   2. Delete rows for this class whose exam_type_id belongs to the master's
//      academic year but is absent from the payload (handles the "removed an
//      applicable exam type" case).
export async function PUT(request: NextRequest, context: RouteContext) {
  const admin = await verifyAdmin();
  if (!admin) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await context.params;

  const { data: master } = await admin
    .from("result_masters")
    .select("id, class_id, academic_year_id")
    .eq("id", id)
    .maybeSingle();
  if (!master) {
    return NextResponse.json({ error: "Result master not found" }, { status: 404 });
  }
  const classId = master.class_id as string;
  const academicYearId = master.academic_year_id as string;

  const body = await request.json();
  const parsed = resultMasterExamConfigsPutSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid data", details: parsed.error.flatten() },
      { status: 400 }
    );
  }
  const { exam_configs } = parsed.data;

  // Dedupe by exam_type_id — the DB has UNIQUE(class_id, exam_type_id).
  const seen = new Set<string>();
  const dupes: string[] = [];
  for (const c of exam_configs) {
    if (seen.has(c.exam_type_id)) dupes.push(c.exam_type_id);
    seen.add(c.exam_type_id);
  }
  if (dupes.length > 0) {
    return NextResponse.json(
      {
        error: `Duplicate exam_type_id in payload: ${dupes.join(", ")}`,
        code: "DUPLICATE_EXAM_TYPE",
      },
      { status: 400 }
    );
  }

  // Ensure every payload exam_type belongs to the master's academic year.
  // Rejects cross-year writes that would otherwise orphan the row.
  const payloadExamTypeIds = exam_configs.map((c) => c.exam_type_id);
  const { data: yearExamTypes, error: etErr } = await admin
    .from("exam_types")
    .select("id")
    .eq("academic_year_id", academicYearId);
  if (etErr) {
    console.error("[result-master.exam-configs.PUT] year exam types fetch:", etErr);
    return NextResponse.json({ error: "Failed to load exam types" }, { status: 500 });
  }
  const yearExamTypeIds = new Set((yearExamTypes ?? []).map((et) => et.id as string));
  const outOfYear = payloadExamTypeIds.filter((eid) => !yearExamTypeIds.has(eid));
  if (outOfYear.length > 0) {
    return NextResponse.json(
      {
        error: `exam_type_id(s) not in master's academic year: ${outOfYear.join(", ")}`,
        code: "EXAM_TYPE_OUT_OF_YEAR",
      },
      { status: 400 }
    );
  }

  const now = new Date().toISOString();
  const rows = exam_configs.map((c) => ({
    class_id: classId,
    exam_type_id: c.exam_type_id,
    is_applicable: c.is_applicable,
    weightage: c.weightage,
    max_marks_override: c.max_marks_override,
    sort_order: c.sort_order,
    updated_at: now,
  }));

  // Upsert (vs. delete+insert) preserves other-year rows for the same class.
  if (rows.length > 0) {
    const { error: upsertErr } = await admin
      .from("class_exam_configs")
      .upsert(rows, { onConflict: "class_id,exam_type_id" });
    if (upsertErr) {
      console.error("[result-master.exam-configs.PUT] upsert:", upsertErr);
      return NextResponse.json(
        {
          error: "Exam configs upsert failed",
          code: "EXAM_CONFIGS_INSERT_FAILED",
        },
        { status: 500 }
      );
    }
  }

  // Remove configs for this class + year whose exam_type is no longer in the
  // payload (e.g., admin removed an exam_type from the year since last save).
  const payloadSet = new Set(payloadExamTypeIds);
  const staleIds = [...yearExamTypeIds].filter((eid) => !payloadSet.has(eid));
  if (staleIds.length > 0) {
    const { error: delErr } = await admin
      .from("class_exam_configs")
      .delete()
      .eq("class_id", classId)
      .in("exam_type_id", staleIds);
    if (delErr) {
      // Non-fatal — upsert already wrote the payload. Log and continue.
      console.warn("Stale exam-config cleanup failed:", delErr.message);
    }
  }

  // Return the current year's rows after the upsert.
  const { data: final, error: finalErr } = await admin
    .from("class_exam_configs")
    .select(
      "id, class_id, exam_type_id, is_applicable, weightage, max_marks_override, sort_order, created_at, updated_at, exam_types!inner(academic_year_id)"
    )
    .eq("class_id", classId)
    .eq("exam_types.academic_year_id", academicYearId)
    .order("sort_order", { ascending: true });
  if (finalErr) {
    console.error("[result-master.exam-configs.PUT] final fetch:", finalErr);
    return NextResponse.json({ error: "Failed to load exam configs" }, { status: 500 });
  }

  return NextResponse.json({ data: final ?? [] });
}
