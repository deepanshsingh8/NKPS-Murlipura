import { NextResponse } from "next/server";
import { createClient } from "@nkps/shared/lib/supabase/server";
import { resultsBulkSchema } from "@nkps/shared/lib/validations";
import { computeGrade, resolveGradeScaleForClass } from "@/lib/grading";
import {
  getTeacherIdForUser,
  teacherTeachesClassSubject,
} from "@/lib/teacher-scope";

export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Verify user is a teacher, admin, or editor with `results` permission.
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
        .eq("feature_key", "results")
        .maybeSingle();
      if (!perm) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
    }

    const body = await request.json();
    const result = resultsBulkSchema.safeParse(body);

    if (!result.success) {
      return NextResponse.json(
        { error: "Invalid data", details: result.error.flatten() },
        { status: 400 }
      );
    }

    const { class_id, subject_id, exam_type_id, entries } = result.data;

    // Teacher ownership: stop a teacher from posting marks to a class/subject
    // they don't teach. Admins skip the check.
    if (profile.role === "teacher") {
      const teacherId = await getTeacherIdForUser(supabase, user.id);
      if (
        !teacherId ||
        !(await teacherTeachesClassSubject(
          supabase,
          teacherId,
          class_id,
          subject_id
        ))
      ) {
        return NextResponse.json(
          { error: "You don't teach this class/subject" },
          { status: 403 }
        );
      }
    }

    // Fetch exam type to get max_marks
    const { data: examType } = await supabase
      .from("exam_types")
      .select("max_marks")
      .eq("id", exam_type_id)
      .single();

    if (!examType) {
      return NextResponse.json(
        { error: "Exam type not found" },
        { status: 404 }
      );
    }

    const maxMarks = examType.max_marks;

    const invalidEntries = entries.filter(
      (entry) => entry.marks_obtained < 0 || entry.marks_obtained > maxMarks
    );
    if (invalidEntries.length > 0) {
      return NextResponse.json(
        {
          error: `Marks must be between 0 and ${maxMarks}`,
          invalid_entries: invalidEntries.map((e) => ({
            student_id: e.student_id,
            marks_obtained: e.marks_obtained,
          })),
        },
        { status: 400 }
      );
    }

    // Resolve the grade scale for this class once (falls back to default scale).
    const scale = await resolveGradeScaleForClass(supabase, class_id);
    const bands = scale?.bands ?? [];

    // Finalized-marksheet lock (audit C4):
    // If any of the target students already has an active per-exam marksheet
    // snapshot for THIS exam (or an active year-final for the class's year),
    // their `results` row is the basis for an audit-frozen marksheet. Allow
    // overwrite ONLY when the caller has the `publish_results` perm AND has
    // explicitly asked to refinalize. Teachers can never silently overwrite a
    // finalized marksheet.
    const studentIds = entries.map((e) => e.student_id);
    let allowFinalizedOverwrite = false;
    if (profile.role === "admin") {
      allowFinalizedOverwrite = true;
    } else {
      // Anyone with the publish_results capability (typically staff, but a
      // teacher could be granted it too) can refinalize. Plain teachers
      // without that grant cannot silently overwrite a finalized marksheet.
      const { data: pubPerm } = await supabase
        .from("editor_permissions")
        .select("feature_key")
        .eq("editor_id", user.id)
        .eq("feature_key", "publish_results")
        .maybeSingle();
      allowFinalizedOverwrite = !!pubPerm;
    }
    if (!allowFinalizedOverwrite) {
      const { data: lockedPubs } = await supabase
        .from("marksheet_publications")
        .select("student_id")
        .eq("class_id", class_id)
        .eq("exam_type_id", exam_type_id)
        .is("unpublished_at", null)
        .in("student_id", studentIds);
      const locked = new Set(
        (lockedPubs ?? []).map((r) => r.student_id as string)
      );
      if (locked.size > 0) {
        return NextResponse.json(
          {
            error:
              "Some students have a finalized marksheet for this exam. Unpublish it first or ask an admin with publish-results to overwrite.",
            locked_student_count: locked.size,
            locked_student_ids: Array.from(locked),
          },
          { status: 409 }
        );
      }
    }

    // Online-publish lock (audit H1):
    // `is_published=true` on `results` means the row is currently visible to
    // students/parents. A non-admin/non-teacher with the `results` perm but
    // no `publish_results` shouldn't silently rewrite a published mark —
    // that bypasses the surgical-unlock workflow. Teachers can update their
    // own subject's published rows (they're the source of truth) so we
    // whitelist the teacher branch.
    if (
      profile.role !== "admin" &&
      profile.role !== "teacher" &&
      !allowFinalizedOverwrite
    ) {
      const { data: publishedRows } = await supabase
        .from("results")
        .select("student_id")
        .eq("class_id", class_id)
        .eq("subject_id", subject_id)
        .eq("exam_type_id", exam_type_id)
        .eq("is_published", true)
        .in("student_id", studentIds);
      if (publishedRows && publishedRows.length > 0) {
        return NextResponse.json(
          {
            error:
              "Some entries are already published. Unpublish those rows first, or call this with publish-results permission.",
            published_student_count: publishedRows.length,
          },
          { status: 409 }
        );
      }
    }

    // Build records for upsert
    const records = entries.map((entry) => ({
      student_id: entry.student_id,
      class_id,
      subject_id,
      exam_type_id,
      marks_obtained: entry.marks_obtained,
      max_marks: maxMarks,
      grade: computeGrade((entry.marks_obtained / maxMarks) * 100, bands),
      entered_by: user.id,
    }));

    const { error } = await supabase
      .from("results")
      .upsert(records, {
        onConflict: "student_id,subject_id,exam_type_id",
      });

    if (error) {
      console.error("Results upsert error:", error);
      return NextResponse.json(
        { error: "Failed to save results" },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true, count: records.length });
  } catch (err) {
    console.error("API error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
