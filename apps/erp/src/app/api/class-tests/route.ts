import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@nkps/shared/lib/supabase/server";
import { classTestCreateSchema } from "@nkps/shared/lib/validations";
import {
  getTeacherIdForUser,
  teacherTeachesClassSubject,
} from "@/lib/teacher-scope";

// GET /api/class-tests?class_id=&subject_id=
// Returns class tests visible to the caller via RLS.
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
  const subjectId = params.get("subject_id");

  let query = supabase
    .from("class_tests")
    .select(
      "id, class_id, subject_id, name, test_date, max_marks, weightage, is_published, created_by, created_at, updated_at"
    )
    .order("test_date", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false });

  if (classId) query = query.eq("class_id", classId);
  if (subjectId) query = query.eq("subject_id", subjectId);

  const { data, error } = await query;
  if (error) {
    console.error("[class-tests.GET] list:", error);
    return NextResponse.json({ error: "Failed to load class tests" }, { status: 500 });
  }
  return NextResponse.json({ data: data ?? [] });
}

// POST /api/class-tests — create a new class test.
// Teacher or admin only; RLS further restricts teachers to their class-subject combos.
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
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (profile.role !== "admin" && profile.role !== "teacher") {
    const { data: perm } = await supabase
      .from("editor_permissions")
      .select("feature_key")
      .eq("editor_id", user.id)
      .eq("feature_key", "class_tests")
      .maybeSingle();
    if (!perm) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
  }

  const body = await request.json();
  const parsed = classTestCreateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid data", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  // M12 — teacher ownership check on the create path. PATCH/DELETE/marks
  // already gate via teacherTeachesClassSubject; this closes the gap so a
  // teacher can't seed tests for a class/subject they don't teach.
  if (profile.role === "teacher") {
    const teacherId = await getTeacherIdForUser(supabase, user.id);
    if (
      !teacherId ||
      !(await teacherTeachesClassSubject(
        supabase,
        teacherId,
        parsed.data.class_id,
        parsed.data.subject_id
      ))
    ) {
      return NextResponse.json(
        { error: "You don't teach this class/subject" },
        { status: 403 }
      );
    }
  }

  const { error, data } = await supabase
    .from("class_tests")
    .insert({
      class_id: parsed.data.class_id,
      subject_id: parsed.data.subject_id,
      name: parsed.data.name.trim(),
      test_date: parsed.data.test_date ?? null,
      max_marks: parsed.data.max_marks,
      weightage: parsed.data.weightage ?? null,
      is_published: parsed.data.is_published ?? false,
      created_by: user.id,
    })
    .select(
      "id, class_id, subject_id, name, test_date, max_marks, weightage, is_published, created_at"
    )
    .single();

  if (error) {
    console.error("[class-tests.POST] insert:", error);
    return NextResponse.json(
      { error: "Failed to create class test" },
      { status: 500 }
    );
  }
  return NextResponse.json({ data });
}
