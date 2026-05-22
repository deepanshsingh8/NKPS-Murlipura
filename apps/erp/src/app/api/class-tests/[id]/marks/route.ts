import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@nkps/shared/lib/supabase/server";
import { classTestMarksBulkSchema } from "@nkps/shared/lib/validations";
import { computeGrade, resolveGradeScaleForClass } from "@/lib/grading";
import {
  getTeacherIdForUser,
  teacherTeachesClassSubject,
} from "@/lib/teacher-scope";

interface RouteParams {
  params: Promise<{ id: string }>;
}

// GET /api/class-tests/[id]/marks — load existing marks for this test.
export async function GET(_request: NextRequest, { params }: RouteParams) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data, error } = await supabase
    .from("class_test_results")
    .select(
      "id, class_test_id, student_id, marks_obtained, max_marks, grade, remarks, updated_at"
    )
    .eq("class_test_id", id);
  if (error) {
    console.error("[class-tests.marks.GET] list:", error);
    return NextResponse.json({ error: "Failed to load class test marks" }, { status: 500 });
  }
  return NextResponse.json({ data: data ?? [] });
}

// POST /api/class-tests/[id]/marks — bulk upsert marks.
// Body: { entries: [{ student_id, marks_obtained | null, remarks? }] }
// Null marks_obtained clears the row for that student.
export async function POST(request: NextRequest, { params }: RouteParams) {
  const { id } = await params;
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
  const parsed = classTestMarksBulkSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid data", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  // Fetch the class_test row for max_marks + class_id + subject_id.
  const { data: ct } = await supabase
    .from("class_tests")
    .select("id, class_id, subject_id, max_marks")
    .eq("id", id)
    .maybeSingle();
  if (!ct) {
    return NextResponse.json({ error: "Class test not found" }, { status: 404 });
  }
  const maxMarks = Number(ct.max_marks);
  const classId = ct.class_id as string;
  const subjectId = ct.subject_id as string;

  // Teacher ownership: the role gate above lets any teacher through, but
  // the URL [id] is user-controlled — without this check a teacher could
  // mutate marks for any class_test in the school.
  if (profile.role === "teacher") {
    const teacherId = await getTeacherIdForUser(supabase, user.id);
    if (
      !teacherId ||
      !(await teacherTeachesClassSubject(supabase, teacherId, classId, subjectId))
    ) {
      return NextResponse.json(
        { error: "You don't teach this class/subject" },
        { status: 403 }
      );
    }
  }

  const invalid = parsed.data.entries.filter(
    (e) => e.marks_obtained !== null && (e.marks_obtained < 0 || e.marks_obtained > maxMarks)
  );
  if (invalid.length > 0) {
    return NextResponse.json(
      {
        error: `Marks must be between 0 and ${maxMarks}`,
        invalid_entries: invalid.map((e) => ({
          student_id: e.student_id,
          marks_obtained: e.marks_obtained,
        })),
      },
      { status: 400 }
    );
  }

  // Resolve grade scale once for the class.
  const scale = await resolveGradeScaleForClass(supabase, classId);
  const bands = scale?.bands ?? [];

  const toUpsert: Array<{
    class_test_id: string;
    student_id: string;
    marks_obtained: number;
    max_marks: number;
    grade: string | null;
    remarks: string | null;
    entered_by: string;
  }> = [];
  const toDelete: string[] = [];
  for (const e of parsed.data.entries) {
    if (e.marks_obtained === null) {
      toDelete.push(e.student_id);
      continue;
    }
    toUpsert.push({
      class_test_id: id,
      student_id: e.student_id,
      marks_obtained: e.marks_obtained,
      max_marks: maxMarks,
      grade: computeGrade((e.marks_obtained / maxMarks) * 100, bands),
      remarks: e.remarks ?? null,
      entered_by: user.id,
    });
  }

  let saved = 0;
  if (toUpsert.length > 0) {
    const { error } = await supabase
      .from("class_test_results")
      .upsert(toUpsert, { onConflict: "class_test_id,student_id" });
    if (error) {
      console.error("Class test results upsert error:", error);
      return NextResponse.json(
        { error: "Failed to save marks" },
        { status: 500 }
      );
    }
    saved = toUpsert.length;
  }

  let cleared = 0;
  if (toDelete.length > 0) {
    const { error, count } = await supabase
      .from("class_test_results")
      .delete({ count: "exact" })
      .eq("class_test_id", id)
      .in("student_id", toDelete);
    if (error) {
      console.error("Class test results clear error:", error);
      return NextResponse.json(
        { error: "Failed to clear marks" },
        { status: 500 }
      );
    }
    cleared = count ?? 0;
  }

  return NextResponse.json({ success: true, saved, cleared });
}
