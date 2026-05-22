import { NextResponse } from "next/server";
import { createClient } from "@nkps/shared/lib/supabase/server";
import { createAdminClient } from "@nkps/shared/lib/supabase/admin";

interface AssignmentRow {
  class_name: string;
  section: string;
  stream?: string;
  subject_name: string;
  subject_code?: string;
  teacher_employee_id?: string;
}

export async function POST(request: Request) {
  try {
    // Verify admin auth
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
    if (profile.role !== "admin") {
      const { data: perm } = await supabase
        .from("editor_permissions")
        .select("feature_key")
        .eq("editor_id", user.id)
        .eq("feature_key", "subjects")
        .maybeSingle();
      if (!perm) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
    }

    const body = await request.json();
    const rows: AssignmentRow[] = body.assignments ?? [];

    if (rows.length === 0) {
      return NextResponse.json(
        { error: "No assignments provided" },
        { status: 400 }
      );
    }

    const admin = createAdminClient();
    const SENIOR_CLASSES = ["XI", "XII"];

    // Fetch current academic year
    const { data: currentYear } = await admin
      .from("academic_years")
      .select("id")
      .eq("is_current", true)
      .single();

    if (!currentYear) {
      return NextResponse.json(
        { error: "No current academic year set" },
        { status: 400 }
      );
    }

    // Fetch streams
    const { data: streamsData } = await admin
      .from("streams")
      .select("id, name");

    const streamMap = new Map<string, string>();
    for (const s of streamsData ?? []) {
      streamMap.set(s.name.toLowerCase(), s.id);
    }

    // Fetch all classes for current year with stream info
    const { data: allClasses } = await admin
      .from("classes")
      .select("id, name, section, stream_id, streams:stream_id(name)")
      .eq("academic_year_id", currentYear.id);

    // Build class lookup: "name|section|streamId" → class_id
    const classMap = new Map<string, string>();
    for (const c of allClasses ?? []) {
      const streamPart = c.stream_id || "";
      const key = `${c.name.trim().toLowerCase()}|${c.section.trim().toLowerCase()}|${streamPart}`;
      classMap.set(key, c.id);
    }

    // Fetch all existing subjects
    const { data: allSubjects } = await admin
      .from("subjects")
      .select("id, name");

    const subjectMap = new Map<string, string>();
    for (const s of allSubjects ?? []) {
      subjectMap.set(s.name.toLowerCase(), s.id);
    }

    // Fetch all teachers
    const { data: allTeachers } = await admin
      .from("teachers")
      .select("id, employee_id");

    const teacherMap = new Map<string, string>();
    for (const t of allTeachers ?? []) {
      teacherMap.set(t.employee_id.toLowerCase(), t.id);
    }

    let created = 0;
    let skipped = 0;
    const errors: { row: number; error: string }[] = [];

    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const className = r.class_name.trim();
      const section = (r.section || "A").trim();
      const stream = r.stream?.trim().toLowerCase() || "";

      // Resolve class_id
      const streamId =
        SENIOR_CLASSES.includes(className) && stream
          ? streamMap.get(stream) || null
          : null;
      const classKey = `${className.toLowerCase()}|${section.toLowerCase()}|${streamId || ""}`;
      const classId = classMap.get(classKey);

      if (!classId) {
        const label = stream
          ? `${className}-${section} (${r.stream?.trim()})`
          : `${className}-${section}`;
        errors.push({ row: i + 1, error: `Class not found: ${label}` });
        continue;
      }

      // Resolve or create subject
      const subjectName = r.subject_name.trim();
      let subjectId = subjectMap.get(subjectName.toLowerCase());

      if (!subjectId) {
        // Create the subject
        const { data: newSubject, error: subErr } = await admin
          .from("subjects")
          .insert({
            name: subjectName,
            code: r.subject_code?.trim() || null,
            is_active: true,
            is_elective: false,
          })
          .select("id")
          .single();

        if (subErr) {
          // Race condition — try fetching
          const { data: found } = await admin
            .from("subjects")
            .select("id")
            .ilike("name", subjectName)
            .single();
          if (found) {
            subjectId = found.id;
            subjectMap.set(subjectName.toLowerCase(), found.id);
          } else {
            errors.push({
              row: i + 1,
              error: `Failed to create subject: ${subjectName}`,
            });
            continue;
          }
        } else if (newSubject) {
          subjectId = newSubject.id;
          subjectMap.set(subjectName.toLowerCase(), newSubject.id);
        }
      }

      if (!subjectId) continue;

      // Resolve teacher (optional)
      let teacherId: string | null = null;
      if (r.teacher_employee_id?.trim()) {
        teacherId =
          teacherMap.get(r.teacher_employee_id.trim().toLowerCase()) || null;
        if (!teacherId) {
          errors.push({
            row: i + 1,
            error: `Teacher not found: ${r.teacher_employee_id.trim()} (assignment will be created without teacher)`,
          });
        }
      }

      // Insert class_subjects
      const { error: insertErr } = await admin.from("class_subjects").insert({
        class_id: classId,
        subject_id: subjectId,
        teacher_id: teacherId,
      });

      if (insertErr) {
        if (insertErr.code === "23505") {
          skipped++;
        } else {
          errors.push({
            row: i + 1,
            error: `Failed to assign ${subjectName} to class: ${insertErr.message}`,
          });
        }
      } else {
        created++;
      }
    }

    return NextResponse.json({
      success: true,
      created,
      skipped,
      errors,
    });
  } catch (err) {
    console.error("Bulk assign error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
