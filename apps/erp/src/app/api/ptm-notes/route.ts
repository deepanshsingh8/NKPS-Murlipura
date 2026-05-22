import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@nkps/shared/lib/supabase/server";
import { ptmNotesBulkSchema } from "@nkps/shared/lib/validations";

// GET /api/ptm-notes?class_id=&exam_type_id=&student_id=
// Returns ptm_notes matching the filters. RLS scopes visibility:
//   - admins: all rows
//   - teachers: rows for students in their class scope
//   - parents: rows for their own children (student_id implied)
// When class_id is supplied, joins through student_enrollments to filter.
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
  const examTypeId = params.get("exam_type_id");
  const studentId = params.get("student_id");

  // Resolve in-scope student ids first when filtering by class — cheaper
  // than a SQL join and keeps the shape simple.
  let studentIdScope: string[] | null = null;
  if (classId) {
    const { data: enrollments } = await supabase
      .from("student_enrollments")
      .select("student_id")
      .eq("class_id", classId)
      .eq("status", "active");
    studentIdScope = (enrollments ?? []).map(
      (e) => e.student_id as string
    );
    // Empty class → return empty list, avoid empty .in() blowing up.
    if (studentIdScope.length === 0) {
      return NextResponse.json({ data: [] });
    }
  }

  let query = supabase
    .from("ptm_notes")
    .select(
      "id, student_id, exam_type_id, meeting_date, attendance, teacher_remarks, parent_remarks, action_points, recorded_by, created_at, updated_at"
    )
    .order("meeting_date", { ascending: false });

  if (studentIdScope) query = query.in("student_id", studentIdScope);
  if (studentId) query = query.eq("student_id", studentId);
  if (examTypeId) query = query.eq("exam_type_id", examTypeId);

  const { data, error } = await query;
  if (error) {
    console.error("[ptm-notes.GET] list:", error);
    return NextResponse.json({ error: "Failed to load PTM notes" }, { status: 500 });
  }
  return NextResponse.json({ data: data ?? [] });
}

// POST /api/ptm-notes
// Body: { exam_type_id?, entries: [{ student_id, meeting_date, attendance,
//   teacher_remarks?, parent_remarks?, action_points? }] }
//
// Bulk upsert via ON CONFLICT(student_id, meeting_date). Teacher and admin
// allowed; RLS enforces per-row access beyond that.
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
      .eq("feature_key", "ptm_notes")
      .maybeSingle();
    if (!perm) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
  }

  const body = await request.json();
  const parsed = ptmNotesBulkSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid data", details: parsed.error.flatten() },
      { status: 400 }
    );
  }
  const { exam_type_id, entries } = parsed.data;

  const rows = entries.map((e) => ({
    student_id: e.student_id,
    exam_type_id: exam_type_id ?? null,
    meeting_date: e.meeting_date,
    attendance: e.attendance,
    teacher_remarks: e.teacher_remarks ?? null,
    parent_remarks: e.parent_remarks ?? null,
    action_points: e.action_points ?? null,
    recorded_by: user.id,
  }));

  const { data, error } = await supabase
    .from("ptm_notes")
    .upsert(rows, { onConflict: "student_id,meeting_date" })
    .select(
      "id, student_id, exam_type_id, meeting_date, attendance, teacher_remarks, parent_remarks, action_points, recorded_by, created_at, updated_at"
    );

  if (error) {
    console.error("[ptm-notes.POST] upsert:", error);
    return NextResponse.json({ error: "Failed to save PTM notes" }, { status: 500 });
  }
  return NextResponse.json({ data: data ?? [], count: data?.length ?? 0 });
}
