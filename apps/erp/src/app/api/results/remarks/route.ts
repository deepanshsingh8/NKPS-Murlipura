import { NextResponse } from "next/server";
import { createClient } from "@nkps/shared/lib/supabase/server";

export async function GET(request: Request) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const examTypeId = searchParams.get("exam_type_id");
    const classId = searchParams.get("class_id");
    const studentId = searchParams.get("student_id");

    if (!examTypeId) {
      return NextResponse.json(
        { error: "exam_type_id is required" },
        { status: 400 }
      );
    }

    // Class-scoped fetch: return all remarks for students in that class
    // for the given exam. Used by the teacher's remarks editor.
    if (classId) {
      const { data: enrollments } = await supabase
        .from("student_enrollments")
        .select("student_id")
        .eq("class_id", classId);

      const studentIds = (enrollments ?? []).map((e) => e.student_id);
      if (studentIds.length === 0) {
        return NextResponse.json({ remarks: [] });
      }

      const { data } = await supabase
        .from("student_remarks")
        .select("student_id, remark, updated_at")
        .eq("exam_type_id", examTypeId)
        .in("student_id", studentIds);

      return NextResponse.json({ remarks: data ?? [] });
    }

    // Single-student fetch
    if (studentId) {
      const { data } = await supabase
        .from("student_remarks")
        .select("student_id, remark, updated_at")
        .eq("exam_type_id", examTypeId)
        .eq("student_id", studentId)
        .maybeSingle();

      return NextResponse.json({ remark: data });
    }

    return NextResponse.json(
      { error: "class_id or student_id is required" },
      { status: 400 }
    );
  } catch (err) {
    console.error("Remarks GET error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

interface RemarkEntry {
  student_id: string;
  remark: string;
}

export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { data: profile } = await supabase
      .from("profiles")
      .select("role, teacher_id")
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
    const examTypeId: string | undefined = body.exam_type_id;
    const classId: string | undefined = body.class_id;
    const entries: RemarkEntry[] | undefined = body.entries;
    const forceOverwrite: boolean = body.force_overwrite === true;

    if (!examTypeId || !Array.isArray(entries)) {
      return NextResponse.json(
        { error: "exam_type_id and entries[] are required" },
        { status: 400 }
      );
    }

    // Remarks are intentionally class-level (a single holistic comment per
    // student per exam type), not subject-scoped — so the gate is "class
    // teacher of the target class" rather than "teaches the subject". A
    // class teacher writes one remark covering the whole report card; subject
    // teachers leave their feedback through individual marks/grades.
    // Admins bypass this check.
    if (profile.role === "teacher") {
      if (!classId) {
        return NextResponse.json(
          { error: "class_id is required for teacher submissions" },
          { status: 400 }
        );
      }
      const { data: classRow } = await supabase
        .from("classes")
        .select("class_teacher_id")
        .eq("id", classId)
        .single();

      if (!classRow || classRow.class_teacher_id !== profile.teacher_id) {
        return NextResponse.json(
          { error: "Only the assigned class teacher can submit remarks for this class" },
          { status: 403 }
        );
      }
    }

    // M10 — non-teacher capability holders (admin/staff/teacher-with-grant
    // who isn't the class teacher) can silently clobber a teacher's draft
    // remark. When the caller is anyone other than the canonical teacher
    // path above, look at the existing rows for the students they're about
    // to write. If any was authored by a profile whose role is "teacher"
    // AND the new entry differs from the existing text, we 409 unless
    // body.force_overwrite is set. The teacher branch above already returned
    // for non-class-teachers, so reaching here as a teacher means this IS
    // the class teacher — they are the canonical author and always overwrite.
    if (profile.role !== "teacher" && !forceOverwrite) {
      const studentIdsToWrite = entries
        .filter((e) => e.remark && e.remark.trim().length > 0)
        .map((e) => e.student_id);
      if (studentIdsToWrite.length > 0) {
        const { data: existingRows } = await supabase
          .from("student_remarks")
          .select("student_id, remark, author_id")
          .eq("exam_type_id", examTypeId)
          .in("student_id", studentIdsToWrite);
        const authorIds = Array.from(
          new Set(
            (existingRows ?? [])
              .map((r) => r.author_id as string | null)
              .filter((v): v is string => !!v && v !== user.id)
          )
        );
        if (authorIds.length > 0) {
          const { data: authors } = await supabase
            .from("profiles")
            .select("id, role")
            .in("id", authorIds);
          const teacherAuthorIds = new Set(
            (authors ?? [])
              .filter((a) => a.role === "teacher")
              .map((a) => a.id as string)
          );
          const existingByStudent = new Map(
            (existingRows ?? []).map((r) => [r.student_id as string, r])
          );
          const conflicts: string[] = [];
          for (const e of entries) {
            const existing = existingByStudent.get(e.student_id);
            if (!existing) continue;
            const existingAuthor = existing.author_id as string | null;
            if (!existingAuthor || !teacherAuthorIds.has(existingAuthor)) continue;
            const newText = (e.remark ?? "").trim();
            if (newText && newText !== (existing.remark ?? "").trim()) {
              conflicts.push(e.student_id);
            }
          }
          if (conflicts.length > 0) {
            return NextResponse.json(
              {
                error: `${conflicts.length} student(s) have a class-teacher remark already. Confirm to overwrite.`,
                conflict_student_ids: conflicts,
                requires_force_overwrite: true,
              },
              { status: 409 }
            );
          }
        }
      }
    }

    // Split into upserts (non-empty) and deletes (empty/whitespace-only remarks)
    const toUpsert = entries
      .filter((e) => e.remark && e.remark.trim().length > 0)
      .map((e) => ({
        student_id: e.student_id,
        exam_type_id: examTypeId,
        remark: e.remark.trim(),
        author_id: user.id,
        updated_at: new Date().toISOString(),
      }));

    const toDeleteStudentIds = entries
      .filter((e) => !e.remark || e.remark.trim().length === 0)
      .map((e) => e.student_id);

    if (toUpsert.length > 0) {
      const { error } = await supabase
        .from("student_remarks")
        .upsert(toUpsert, { onConflict: "student_id,exam_type_id" });

      if (error) {
        console.error("Remarks upsert error:", error);
        return NextResponse.json(
          { error: "Failed to save remarks" },
          { status: 500 }
        );
      }
    }

    if (toDeleteStudentIds.length > 0) {
      const { error } = await supabase
        .from("student_remarks")
        .delete()
        .eq("exam_type_id", examTypeId)
        .in("student_id", toDeleteStudentIds);

      if (error) {
        console.error("Remarks delete error:", error);
        return NextResponse.json(
          { error: "Failed to clear remarks" },
          { status: 500 }
        );
      }
    }

    return NextResponse.json({
      success: true,
      saved: toUpsert.length,
      cleared: toDeleteStudentIds.length,
    });
  } catch (err) {
    console.error("Remarks POST error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
