import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@nkps/shared/lib/supabase/server";
import { nonScholasticAssessmentsBulkSchema } from "@nkps/shared/lib/validations";
import {
  getTeacherIdForUser,
  teacherCanAccessClass,
} from "@/lib/teacher-scope";

// GET /api/non-scholastic-assessments?class_id=&exam_type_id=&sub_subject_id=&student_id=
// Returns assessments matching the filters. RLS handles role-based access.
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
  const subSubjectId = params.get("sub_subject_id");
  const studentId = params.get("student_id");

  let query = supabase
    .from("non_scholastic_assessments")
    .select(
      "id, student_id, class_id, exam_type_id, sub_subject_id, grade_label, remarks, is_published, updated_at"
    );

  if (classId) query = query.eq("class_id", classId);
  if (examTypeId) query = query.eq("exam_type_id", examTypeId);
  if (subSubjectId) query = query.eq("sub_subject_id", subSubjectId);
  if (studentId) query = query.eq("student_id", studentId);

  const { data, error } = await query;
  if (error) {
    console.error("[non-scholastic-assessments.GET] list:", error);
    return NextResponse.json({ error: "Failed to load non-scholastic assessments" }, { status: 500 });
  }
  return NextResponse.json({ data: data ?? [] });
}

// POST /api/non-scholastic-assessments
// Body: { class_id, exam_type_id, entries: [{ student_id, sub_subject_id, grade_label, remarks? }] }
// A null grade_label clears the existing assessment row.
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
        .eq("feature_key", "non_scholastic_entry")
        .maybeSingle();
      if (!perm) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
    }

    const body = await request.json();
    const parsed = nonScholasticAssessmentsBulkSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid data", details: parsed.error.flatten() },
        { status: 400 }
      );
    }
    const { class_id, exam_type_id, entries } = parsed.data;

    // Teacher ownership: a teacher can only enter non-scholastic grades for
    // classes they teach. Non-scholastic isn't tied to a single subject, so
    // we use the broader class-access check (class teacher OR teaches any
    // subject in the class).
    //
    // Editors with the `non_scholastic_entry` feature key are intentionally
    // NOT scoped here (audit L6). The permission is school-wide by design —
    // the office/secretary uses it to enter values across classes during PTM
    // weeks. If a class-level scope is needed in the future, add a
    // `non_scholastic_entry_class_ids` mapping similar to the timetable
    // approach rather than splitting the feature_key.
    if (profile.role === "teacher") {
      const teacherId = await getTeacherIdForUser(supabase, user.id);
      if (
        !teacherId ||
        !(await teacherCanAccessClass(supabase, teacherId, class_id))
      ) {
        return NextResponse.json(
          { error: "You don't have access to this class" },
          { status: 403 }
        );
      }
    }

    // Resolve applicable grade scale per sub_subject_id referenced in this batch.
    // Preference order: sub_subject.grade_scale_id → non-scholastic default scale.
    const subSubjectIds = Array.from(new Set(entries.map((e) => e.sub_subject_id)));
    const { data: subSubjects } = await supabase
      .from("non_scholastic_sub_subjects")
      .select("id, grade_scale_id")
      .in("id", subSubjectIds);

    const subById = new Map<string, { grade_scale_id: string | null }>();
    for (const s of subSubjects ?? []) {
      subById.set(s.id as string, { grade_scale_id: s.grade_scale_id as string | null });
    }

    // Find the non-scholastic default scale (one per deployment).
    const { data: defaultScale } = await supabase
      .from("grade_scales")
      .select("id")
      .eq("scope", "non_scholastic")
      .eq("is_default", true)
      .maybeSingle();
    const defaultScaleId = (defaultScale?.id as string | undefined) ?? null;

    // Unique scale ids we need band labels for.
    const scaleIdsToLoad = new Set<string>();
    for (const e of entries) {
      const sub = subById.get(e.sub_subject_id);
      const scaleId = sub?.grade_scale_id ?? defaultScaleId;
      if (scaleId) scaleIdsToLoad.add(scaleId);
    }

    let labelsByScale = new Map<string, Set<string>>();
    if (scaleIdsToLoad.size > 0) {
      const { data: bands } = await supabase
        .from("grade_bands")
        .select("grade_scale_id, label")
        .in("grade_scale_id", Array.from(scaleIdsToLoad));
      labelsByScale = new Map<string, Set<string>>();
      for (const b of bands ?? []) {
        const scaleId = b.grade_scale_id as string;
        if (!labelsByScale.has(scaleId)) labelsByScale.set(scaleId, new Set());
        labelsByScale.get(scaleId)!.add(b.label as string);
      }
    }

    // Split into upserts (grade_label set) and clears (grade_label null).
    const toUpsert: Array<{
      student_id: string;
      class_id: string;
      exam_type_id: string;
      sub_subject_id: string;
      grade_label: string;
      remarks: string | null;
      entered_by: string;
    }> = [];
    const clears: Array<{ student_id: string; sub_subject_id: string }> = [];

    const invalid: Array<{ student_id: string; sub_subject_id: string; reason: string }> = [];

    for (const e of entries) {
      if (!e.grade_label) {
        clears.push({ student_id: e.student_id, sub_subject_id: e.sub_subject_id });
        continue;
      }
      const sub = subById.get(e.sub_subject_id);
      if (!sub) {
        invalid.push({
          student_id: e.student_id,
          sub_subject_id: e.sub_subject_id,
          reason: "Unknown sub-subject",
        });
        continue;
      }
      const scaleId = sub.grade_scale_id ?? defaultScaleId;
      const labels = scaleId ? labelsByScale.get(scaleId) : undefined;
      if (!labels || !labels.has(e.grade_label)) {
        invalid.push({
          student_id: e.student_id,
          sub_subject_id: e.sub_subject_id,
          reason: `Grade label "${e.grade_label}" is not in the applicable scale`,
        });
        continue;
      }
      toUpsert.push({
        student_id: e.student_id,
        class_id,
        exam_type_id,
        sub_subject_id: e.sub_subject_id,
        grade_label: e.grade_label,
        remarks: e.remarks ?? null,
        entered_by: user.id,
      });
    }

    if (invalid.length > 0) {
      return NextResponse.json(
        { error: "Some entries have invalid grade labels", invalid_entries: invalid },
        { status: 400 }
      );
    }

    let upsertedCount = 0;
    if (toUpsert.length > 0) {
      const { error: upsertErr } = await supabase
        .from("non_scholastic_assessments")
        .upsert(toUpsert, {
          onConflict: "student_id,exam_type_id,sub_subject_id",
        });
      if (upsertErr) {
        console.error("Non-scholastic upsert error:", upsertErr);
        return NextResponse.json(
          { error: "Failed to save assessments" },
          { status: 500 }
        );
      }
      upsertedCount = toUpsert.length;
    }

    let clearedCount = 0;
    if (clears.length > 0) {
      // Delete rows for cleared entries one sub-subject at a time (compact loop
      // over the small set of sub-subjects in the batch).
      const bySub = new Map<string, string[]>();
      for (const c of clears) {
        if (!bySub.has(c.sub_subject_id)) bySub.set(c.sub_subject_id, []);
        bySub.get(c.sub_subject_id)!.push(c.student_id);
      }
      for (const [subSubjectId, studentIds] of bySub.entries()) {
        const { error: delErr, count } = await supabase
          .from("non_scholastic_assessments")
          .delete({ count: "exact" })
          .eq("exam_type_id", exam_type_id)
          .eq("sub_subject_id", subSubjectId)
          .in("student_id", studentIds);
        if (delErr) {
          console.error("Non-scholastic clear error:", delErr);
          return NextResponse.json(
            { error: "Failed to clear assessments" },
            { status: 500 }
          );
        }
        clearedCount += count ?? 0;
      }
    }

    return NextResponse.json({
      success: true,
      saved: upsertedCount,
      cleared: clearedCount,
    });
  } catch (err) {
    console.error("Non-scholastic API error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
