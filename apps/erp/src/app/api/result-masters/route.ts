import { NextRequest, NextResponse } from "next/server";
import { verifyAdmin } from "@nkps/shared/lib/verify-admin";
import { resultMasterCreateSchema } from "@nkps/shared/lib/validations";
import { validatePassCriteria } from "@/lib/result-master-validation";

// GET /api/result-masters?class_id=&academic_year_id=
// Returns { master, subjects, exam_configs }. master === null when no config
// exists — UI renders empty state. exam_configs is always loaded so the admin
// can configure weightage (class_exam_configs) even before creating the master.
export async function GET(request: NextRequest) {
  const admin = await verifyAdmin();
  if (!admin) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const classId = searchParams.get("class_id");
  const academicYearId = searchParams.get("academic_year_id");
  if (!classId || !academicYearId) {
    return NextResponse.json(
      { error: "class_id and academic_year_id are required" },
      { status: 400 }
    );
  }

  const { data: masterRow, error: masterErr } = await admin
    .from("result_masters")
    .select("*")
    .eq("class_id", classId)
    .eq("academic_year_id", academicYearId)
    .maybeSingle();
  if (masterErr) {
    console.error("[result-masters.GET] master fetch:", masterErr);
    return NextResponse.json({ error: "Failed to load result master" }, { status: 500 });
  }

  let subjects: unknown[] = [];
  if (masterRow) {
    const { data: subjectRows, error: subjErr } = await admin
      .from("result_master_subjects")
      .select(
        "id, result_master_id, subject_id, role, pass_mark_value_override, sort_order, created_at"
      )
      .eq("result_master_id", masterRow.id)
      .order("sort_order", { ascending: true });
    if (subjErr) {
      console.error("[result-masters.GET] subjects fetch:", subjErr);
      return NextResponse.json({ error: "Failed to load result master subjects" }, { status: 500 });
    }
    subjects = subjectRows ?? [];
  }

  // Load class_exam_configs joined with exam_types and filter to the requested
  // academic year on the joined side (exam_types are scoped per year).
  const { data: configRows, error: configErr } = await admin
    .from("class_exam_configs")
    .select(
      "id, class_id, exam_type_id, is_applicable, weightage, max_marks_override, sort_order, created_at, updated_at, exam_types(id, name, kind, max_marks, sort_order, academic_year_id)"
    )
    .eq("class_id", classId)
    .order("sort_order", { ascending: true });
  if (configErr) {
    console.error("[result-masters.GET] exam configs fetch:", configErr);
    return NextResponse.json({ error: "Failed to load exam configs" }, { status: 500 });
  }

  const examConfigs = (configRows ?? []).filter((row) => {
    const et = row.exam_types as unknown as { academic_year_id?: string } | null;
    return et?.academic_year_id === academicYearId;
  });

  return NextResponse.json({
    master: masterRow ?? null,
    subjects,
    exam_configs: examConfigs,
  });
}

// POST /api/result-masters
// Creates a single result_masters row. Subjects are written via the PUT
// /[id]/subjects endpoint immediately after.
export async function POST(request: NextRequest) {
  const admin = await verifyAdmin();
  if (!admin) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const parsed = resultMasterCreateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid data", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const data = parsed.data;

  // Validate pass criteria config shape if either field was provided.
  if (data.pass_criteria_type !== undefined || data.pass_criteria_config !== undefined) {
    const type = data.pass_criteria_type ?? "all_main_subjects";
    const config = data.pass_criteria_config ?? {};
    const err = validatePassCriteria(type, config);
    if (err) return NextResponse.json({ error: err }, { status: 400 });
  }

  // Uniqueness pre-check (clean 409) — DB unique constraint is the final guard.
  const { data: existing } = await admin
    .from("result_masters")
    .select("id")
    .eq("class_id", data.class_id)
    .eq("academic_year_id", data.academic_year_id)
    .maybeSingle();
  if (existing) {
    return NextResponse.json(
      {
        error: "Config already exists for this class+year",
        code: "RESULT_MASTER_EXISTS",
      },
      { status: 409 }
    );
  }

  // Strip undefined so DB defaults apply to omitted fields.
  const insert: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    if (value !== undefined) insert[key] = value;
  }

  const { data: created, error } = await admin
    .from("result_masters")
    .insert(insert)
    .select("*")
    .single();
  if (error) {
    if (error.code === "23505") {
      return NextResponse.json(
        {
          error: "Config already exists for this class+year",
          code: "RESULT_MASTER_EXISTS",
        },
        { status: 409 }
      );
    }
    console.error("[result-masters.POST] insert:", error);
    return NextResponse.json({ error: "Failed to create result master" }, { status: 500 });
  }

  return NextResponse.json({ data: created }, { status: 201 });
}
