import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@nkps/shared/lib/supabase/server";
import { supplementaryAttemptsBulkSchema } from "@nkps/shared/lib/validations";

// GET /api/supplementary?class_id=&parent_exam_type_id=&student_id=
// List existing supplementary_attempts. RLS scopes visibility per role.
export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const params = request.nextUrl.searchParams;
  const classId = params.get("class_id");
  const examTypeId = params.get("parent_exam_type_id");
  const studentId = params.get("student_id");

  let query = supabase
    .from("supplementary_attempts")
    .select(
      "id, student_id, parent_exam_type_id, subject_id, class_id, retest_date, marks_obtained, max_marks, passed, entered_by, created_at, updated_at"
    )
    .order("created_at", { ascending: false });

  if (classId) query = query.eq("class_id", classId);
  if (examTypeId) query = query.eq("parent_exam_type_id", examTypeId);
  if (studentId) query = query.eq("student_id", studentId);

  const { data, error } = await query;
  if (error) {
    console.error("[supplementary.GET] list:", error);
    return NextResponse.json({ error: "Failed to load supplementary attempts" }, { status: 500 });
  }
  return NextResponse.json({ data: data ?? [] });
}

// POST /api/supplementary
// Body: { class_id, parent_exam_type_id, retest_date?, entries: [{
//   student_id, subject_id, marks_obtained, max_marks, passed }] }
// Bulk upsert with onConflict on (student_id, parent_exam_type_id, subject_id).
// `passed` is the caller's call — usually computed client-side from
// (marks_obtained / max_marks) >= retest pass mark, but we leave the
// decision in the UI so admins can manually override edge cases.
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();
  if (!profile) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (profile.role !== "admin" && profile.role !== "teacher") {
    const { data: perm } = await supabase
      .from("editor_permissions")
      .select("feature_key")
      .eq("editor_id", user.id)
      .eq("feature_key", "supplementary_exams")
      .maybeSingle();
    if (!perm) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
  }

  const body = await request.json();
  const parsed = supplementaryAttemptsBulkSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid data", details: parsed.error.flatten() },
      { status: 400 }
    );
  }
  const { class_id, parent_exam_type_id, retest_date, entries } = parsed.data;

  const rows = entries.map((e) => ({
    student_id: e.student_id,
    parent_exam_type_id,
    subject_id: e.subject_id,
    class_id,
    retest_date: retest_date ?? null,
    marks_obtained: e.marks_obtained,
    max_marks: e.max_marks,
    passed: e.passed,
    entered_by: user.id,
  }));

  const { data, error } = await supabase
    .from("supplementary_attempts")
    .upsert(rows, {
      onConflict: "student_id,parent_exam_type_id,subject_id",
    })
    .select(
      "id, student_id, subject_id, marks_obtained, max_marks, passed, retest_date"
    );

  if (error) {
    console.error("[supplementary.POST] upsert:", error);
    return NextResponse.json({ error: "Failed to save supplementary attempts" }, { status: 500 });
  }
  return NextResponse.json({ data: data ?? [], count: data?.length ?? 0 });
}
