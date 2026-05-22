import { NextResponse } from "next/server";
import { createClient } from "@nkps/shared/lib/supabase/server";
import { createAdminClient } from "@nkps/shared/lib/supabase/admin";

interface SubjectInput {
  name: string;
  code: string;
  is_elective: boolean;
  nickname?: string | null;
  category?: "languages" | "academic" | "co_curricular" | null;
}

interface AssignmentInput {
  class_name: string;
  section: string;
  stream_name?: string | null;
  subject_name: string;
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
    const subjects: SubjectInput[] = body.subjects ?? [];
    const assignments: AssignmentInput[] = body.assignments ?? [];

    if (subjects.length === 0 && assignments.length === 0) {
      return NextResponse.json(
        { error: "No subjects or assignments provided" },
        { status: 400 }
      );
    }

    const admin = createAdminClient();

    // ── Step 1: Create subjects (skip existing by name) ──

    // Fetch all existing subjects
    const { data: existingSubjects } = await admin
      .from("subjects")
      .select("id, name");

    const existingSubjectMap = new Map<string, string>();
    for (const s of existingSubjects ?? []) {
      existingSubjectMap.set(s.name.toLowerCase(), s.id);
    }

    let subjectsCreated = 0;
    let subjectsSkipped = 0;

    for (const s of subjects) {
      const key = s.name.trim().toLowerCase();
      if (existingSubjectMap.has(key)) {
        subjectsSkipped++;
        continue;
      }

      const { data: created, error } = await admin
        .from("subjects")
        .insert({
          name: s.name.trim(),
          code: s.code.trim() || null,
          nickname: s.nickname?.trim() || null,
          // Default to 'academic' so the §8 NOT-NULL filter in list views still
          // shows wizard-created subjects. Admin can re-categorize later.
          category: s.category ?? "academic",
          is_active: true,
          is_elective: s.is_elective,
        })
        .select("id")
        .single();

      if (error) {
        // May be a race condition duplicate — try fetching
        const { data: found } = await admin
          .from("subjects")
          .select("id")
          .ilike("name", s.name.trim())
          .single();

        if (found) {
          existingSubjectMap.set(key, found.id);
          subjectsSkipped++;
        }
      } else if (created) {
        existingSubjectMap.set(key, created.id);
        subjectsCreated++;
      }
    }

    // ── Step 2: Create class-subject assignments ──

    // Fetch current academic year
    const { data: currentYear } = await admin
      .from("academic_years")
      .select("id")
      .eq("is_current", true)
      .single();

    if (!currentYear) {
      return NextResponse.json(
        {
          error: "No current academic year set",
          subjects_created: subjectsCreated,
          subjects_skipped: subjectsSkipped,
        },
        { status: 400 }
      );
    }

    // Fetch all classes for current year with stream info
    const { data: allClasses } = await admin
      .from("classes")
      .select("id, name, section, stream_id, streams:stream_id(name)")
      .eq("academic_year_id", currentYear.id);

    // Build class lookup: "name|section|stream_name" → class_id
    const classMap = new Map<string, string>();
    for (const c of allClasses ?? []) {
      const streams = c.streams as unknown as { name: string } | null;
      const streamName = streams?.name?.toLowerCase() ?? "";
      const key = `${c.name.toLowerCase()}|${c.section.toLowerCase()}|${streamName}`;
      classMap.set(key, c.id);
    }

    // Fetch existing class_subjects to avoid duplicates
    const classIds = (allClasses ?? []).map(
      (c: { id: string }) => c.id
    );
    const { data: existingAssignments } = await admin
      .from("class_subjects")
      .select("class_id, subject_id")
      .in("class_id", classIds.length > 0 ? classIds : ["__none__"]);

    const existingAssignmentSet = new Set<string>();
    for (const a of existingAssignments ?? []) {
      existingAssignmentSet.add(`${a.class_id}|${a.subject_id}`);
    }

    let assignmentsCreated = 0;
    let assignmentsSkipped = 0;
    const missingClasses: string[] = [];

    for (const a of assignments) {
      const streamKey = a.stream_name?.toLowerCase() ?? "";
      const classKey = `${a.class_name.toLowerCase()}|${a.section.toLowerCase()}|${streamKey}`;
      const classId = classMap.get(classKey);

      if (!classId) {
        const label = a.stream_name
          ? `${a.class_name}-${a.section} (${a.stream_name})`
          : `${a.class_name}-${a.section}`;
        if (!missingClasses.includes(label)) {
          missingClasses.push(label);
        }
        assignmentsSkipped++;
        continue;
      }

      const subjectId = existingSubjectMap.get(
        a.subject_name.trim().toLowerCase()
      );
      if (!subjectId) {
        assignmentsSkipped++;
        continue;
      }

      // Check if already assigned
      const assignKey = `${classId}|${subjectId}`;
      if (existingAssignmentSet.has(assignKey)) {
        assignmentsSkipped++;
        continue;
      }

      const { error } = await admin.from("class_subjects").insert({
        class_id: classId,
        subject_id: subjectId,
        teacher_id: null,
      });

      if (error) {
        // Duplicate constraint error — skip
        assignmentsSkipped++;
      } else {
        existingAssignmentSet.add(assignKey);
        assignmentsCreated++;
      }
    }

    return NextResponse.json({
      success: true,
      subjects_created: subjectsCreated,
      subjects_skipped: subjectsSkipped,
      assignments_created: assignmentsCreated,
      assignments_skipped: assignmentsSkipped,
      missing_classes: missingClasses,
    });
  } catch (err) {
    console.error("Quick setup error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
