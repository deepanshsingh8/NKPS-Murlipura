import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@nkps/shared/lib/supabase/server";
import { classTestUpdateSchema } from "@nkps/shared/lib/validations";
import {
  getTeacherIdForUser,
  teacherTeachesClassSubject,
} from "@/lib/teacher-scope";

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * Loads the class_test row addressed by [id] and, when the caller is a
 * teacher, confirms they teach the (class_id, subject_id) pair. Admins skip
 * the ownership check.
 */
async function loadClassTestAndAuthorize(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  testId: string
): Promise<
  | { ok: true; classId: string; subjectId: string }
  | { ok: false; status: number; error: string }
> {
  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", userId)
    .single();
  if (!profile) {
    return { ok: false, status: 401, error: "Unauthorized" };
  }
  if (profile.role !== "admin" && profile.role !== "teacher") {
    const { data: perm } = await supabase
      .from("editor_permissions")
      .select("feature_key")
      .eq("editor_id", userId)
      .eq("feature_key", "class_tests")
      .maybeSingle();
    if (!perm) {
      return { ok: false, status: 403, error: "Forbidden" };
    }
  }

  const { data: ct } = await supabase
    .from("class_tests")
    .select("id, class_id, subject_id")
    .eq("id", testId)
    .maybeSingle();
  if (!ct) {
    return { ok: false, status: 404, error: "Class test not found" };
  }

  if (profile.role === "teacher") {
    const teacherId = await getTeacherIdForUser(supabase, userId);
    if (
      !teacherId ||
      !(await teacherTeachesClassSubject(
        supabase,
        teacherId,
        ct.class_id as string,
        ct.subject_id as string
      ))
    ) {
      return {
        ok: false,
        status: 403,
        error: "You don't teach this class/subject",
      };
    }
  }

  return {
    ok: true,
    classId: ct.class_id as string,
    subjectId: ct.subject_id as string,
  };
}

export async function PATCH(request: NextRequest, { params }: RouteParams) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const auth = await loadClassTestAndAuthorize(supabase, user.id, id);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const body = await request.json();
  const parsed = classTestUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid data", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const patch: Record<string, unknown> = {};
  if (parsed.data.name !== undefined) patch.name = parsed.data.name.trim();
  if (parsed.data.test_date !== undefined) patch.test_date = parsed.data.test_date;
  if (parsed.data.max_marks !== undefined) patch.max_marks = parsed.data.max_marks;
  if (parsed.data.weightage !== undefined) patch.weightage = parsed.data.weightage;
  if (parsed.data.is_published !== undefined) patch.is_published = parsed.data.is_published;

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "No fields to update" }, { status: 400 });
  }
  patch.updated_at = new Date().toISOString();

  const { error, data } = await supabase
    .from("class_tests")
    .update(patch)
    .eq("id", id)
    .select(
      "id, class_id, subject_id, name, test_date, max_marks, weightage, is_published, updated_at"
    )
    .single();

  if (error) {
    console.error("Class test update error:", error);
    return NextResponse.json(
      { error: "Failed to update class test" },
      { status: 500 }
    );
  }
  return NextResponse.json({ data });
}

export async function DELETE(_request: NextRequest, { params }: RouteParams) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const auth = await loadClassTestAndAuthorize(supabase, user.id, id);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const { error } = await supabase.from("class_tests").delete().eq("id", id);
  if (error) {
    console.error("Class test delete error:", error);
    return NextResponse.json(
      { error: "Failed to delete class test" },
      { status: 500 }
    );
  }
  return NextResponse.json({ success: true });
}
