import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { verifyAdminOrEditorWithUser } from "@nkps/shared/lib/verify-admin";
import { computeGrade, resolveGradeScaleForClass } from "@/lib/grading";

// Per-student results editor (admin / editor with `results` feature).
// Lets staff search a student and edit/delete their marks across exams,
// independent of teacher class-subject assignments. Service-role client
// bypasses RLS, but the `verifyAdminOrEditorWithUser` gate keeps it locked
// to admins + editors who hold the `results` permission.
//
// Published rows are protected by surgical unlock — admin must call
// PATCH ?unlock=row|exam first to flip is_published=false on just those
// rows (no class-wide republish needed).

// GET /api/results/by-student?student_id=...
// Returns: student summary, list of exams the student has results for,
// and all results grouped by exam → subject.
export async function GET(request: NextRequest) {
  const auth = await verifyAdminOrEditorWithUser("results");
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { admin } = auth;

  const studentId = request.nextUrl.searchParams.get("student_id");
  if (!studentId) {
    return NextResponse.json({ error: "student_id is required" }, { status: 400 });
  }

  const { data: student, error: studentErr } = await admin
    .from("students")
    .select("id, full_name, admission_no, photo_url, is_active")
    .eq("id", studentId)
    .maybeSingle();
  if (studentErr || !student) {
    return NextResponse.json({ error: "Student not found" }, { status: 404 });
  }

  // Pick the most representative enrollment (current year + active first).
  const { data: currentYear } = await admin
    .from("academic_years")
    .select("id")
    .eq("is_current", true)
    .maybeSingle();
  const { data: enrollments } = await admin
    .from("student_enrollments")
    .select(
      "class_id, status, academic_year_id, created_at, classes(id, name, section, academic_year_id, streams:stream_id(name))"
    )
    .eq("student_id", studentId);
  type Enrollment = NonNullable<typeof enrollments>[number];
  const sorted = (enrollments ?? []).slice().sort((a: Enrollment, b: Enrollment) => {
    const aYear = currentYear && a.academic_year_id === currentYear.id ? 0 : 1;
    const bYear = currentYear && b.academic_year_id === currentYear.id ? 0 : 1;
    if (aYear !== bYear) return aYear - bYear;
    const aStatus = a.status === "active" ? 0 : 1;
    const bStatus = b.status === "active" ? 0 : 1;
    if (aStatus !== bStatus) return aStatus - bStatus;
    return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
  });
  const primaryEnrollment = sorted[0] ?? null;
  const primaryClass = primaryEnrollment?.classes as unknown as
    | {
        id: string;
        name: string;
        section: string | null;
        academic_year_id: string;
        streams?: { name: string } | { name: string }[] | null;
      }
    | null;

  // All results for this student. Join exam_types + subjects + classes for
  // human-readable rendering on the client (never display raw UUIDs).
  const { data: rows, error: rowsErr } = await admin
    .from("results")
    .select(
      "id, marks_obtained, max_marks, grade, is_published, class_id, exam_type_id, subject_id, updated_at, classes(id, name, section, streams:stream_id(name)), exam_types(id, name, max_marks, sort_order, academic_year_id), subjects(id, name, code)"
    )
    .eq("student_id", studentId)
    .order("updated_at", { ascending: false });
  if (rowsErr) {
    return NextResponse.json({ error: rowsErr.message }, { status: 500 });
  }

  type Row = NonNullable<typeof rows>[number];
  type ExamMeta = {
    exam_type_id: string;
    exam_name: string;
    exam_max_marks: number;
    sort_order: number;
    academic_year_id: string | null;
    class_id: string;
    class_name: string;
    class_section: string | null;
    class_stream: string | null;
  };
  const examMap = new Map<string, ExamMeta>();
  const resultsByExam = new Map<
    string,
    Array<{
      id: string;
      subject_id: string;
      subject_name: string;
      subject_code: string | null;
      marks_obtained: number;
      max_marks: number;
      grade: string | null;
      is_published: boolean;
      updated_at: string;
    }>
  >();

  const pickStream = (s: unknown): string | null => {
    if (!s) return null;
    if (Array.isArray(s)) return (s[0] as { name?: string } | undefined)?.name ?? null;
    return (s as { name?: string }).name ?? null;
  };

  for (const r of (rows ?? []) as Row[]) {
    const exam = r.exam_types as unknown as {
      id: string;
      name: string;
      max_marks: number;
      sort_order: number;
      academic_year_id: string | null;
    } | null;
    const sub = r.subjects as unknown as { id: string; name: string; code: string | null } | null;
    const cls = r.classes as unknown as {
      id: string;
      name: string;
      section: string | null;
      streams?: unknown;
    } | null;
    if (!exam || !sub || !cls) continue;

    if (!examMap.has(exam.id)) {
      examMap.set(exam.id, {
        exam_type_id: exam.id,
        exam_name: exam.name,
        exam_max_marks: Number(exam.max_marks),
        sort_order: exam.sort_order ?? 0,
        academic_year_id: exam.academic_year_id ?? null,
        class_id: cls.id,
        class_name: cls.name,
        class_section: cls.section,
        class_stream: pickStream(cls.streams),
      });
    }
    const list = resultsByExam.get(exam.id) ?? [];
    list.push({
      id: r.id as string,
      subject_id: sub.id,
      subject_name: sub.name,
      subject_code: sub.code,
      marks_obtained: Number(r.marks_obtained),
      max_marks: Number(r.max_marks),
      grade: (r.grade as string | null) ?? null,
      is_published: Boolean(r.is_published),
      updated_at: r.updated_at as string,
    });
    resultsByExam.set(exam.id, list);
  }

  const exams = Array.from(examMap.values()).sort((a, b) => {
    if (a.sort_order !== b.sort_order) return a.sort_order - b.sort_order;
    return a.exam_name.localeCompare(b.exam_name);
  });

  // For each exam, expose the full subject roster of that exam's class so
  // the editor can show "missing" subjects with an "+ add" button.
  const classIds = Array.from(new Set(exams.map((e) => e.class_id)));
  const subjectRosterByClass = new Map<
    string,
    Array<{ subject_id: string; subject_name: string; subject_code: string | null }>
  >();
  if (classIds.length > 0) {
    const { data: cs } = await admin
      .from("class_subjects")
      .select("class_id, subjects(id, name, code)")
      .in("class_id", classIds);
    for (const row of cs ?? []) {
      const sub = row.subjects as unknown as { id: string; name: string; code: string | null } | null;
      if (!sub) continue;
      const cid = row.class_id as string;
      const arr = subjectRosterByClass.get(cid) ?? [];
      arr.push({
        subject_id: sub.id,
        subject_name: sub.name,
        subject_code: sub.code,
      });
      subjectRosterByClass.set(cid, arr);
    }
    for (const [cid, arr] of subjectRosterByClass) {
      arr.sort((a, b) => a.subject_name.localeCompare(b.subject_name));
      subjectRosterByClass.set(cid, arr);
    }
  }

  return NextResponse.json({
    data: {
      student: {
        id: student.id,
        full_name: student.full_name,
        admission_no: student.admission_no,
        photo_url: student.photo_url,
        is_active: student.is_active,
      },
      primary_class: primaryClass
        ? {
            id: primaryClass.id,
            name: primaryClass.name,
            section: primaryClass.section,
            stream: pickStream(primaryClass.streams),
          }
        : null,
      exams: exams.map((e) => ({
        ...e,
        subjects: resultsByExam.get(e.exam_type_id) ?? [],
        subject_roster: subjectRosterByClass.get(e.class_id) ?? [],
      })),
    },
  });
}

const upsertSchema = z.object({
  student_id: z.string().uuid(),
  class_id: z.string().uuid(),
  subject_id: z.string().uuid(),
  exam_type_id: z.string().uuid(),
  marks_obtained: z.number().finite().min(0),
});

// POST /api/results/by-student
// Upserts one (student, exam_type, subject) row. Recomputes grade. Refuses
// to mutate a published row — caller must surgical-unlock first via PATCH.
export async function POST(request: NextRequest) {
  const auth = await verifyAdminOrEditorWithUser("results");
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { admin, user } = auth;

  const body = await request.json();
  const parsed = upsertSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid data", details: parsed.error.flatten() },
      { status: 400 }
    );
  }
  const { student_id, class_id, subject_id, exam_type_id, marks_obtained } = parsed.data;

  const { data: examType } = await admin
    .from("exam_types")
    .select("max_marks")
    .eq("id", exam_type_id)
    .maybeSingle();
  if (!examType) {
    return NextResponse.json({ error: "Exam type not found" }, { status: 404 });
  }
  const maxMarks = Number(examType.max_marks);
  if (marks_obtained > maxMarks) {
    return NextResponse.json(
      { error: `Marks must be between 0 and ${maxMarks}` },
      { status: 400 }
    );
  }

  // If the row already exists and is published, refuse — admin must unlock first.
  const { data: existing } = await admin
    .from("results")
    .select("id, is_published")
    .eq("student_id", student_id)
    .eq("subject_id", subject_id)
    .eq("exam_type_id", exam_type_id)
    .maybeSingle();
  if (existing?.is_published) {
    return NextResponse.json(
      {
        error: "This result is published. Unlock it before editing.",
        code: "PUBLISHED_LOCKED",
        result_id: existing.id,
      },
      { status: 409 }
    );
  }

  const scale = await resolveGradeScaleForClass(admin, class_id, "scholastic");
  const bands = scale?.bands ?? [];
  const grade = bands.length > 0 ? computeGrade((marks_obtained / maxMarks) * 100, bands) : null;

  const { data: upserted, error } = await admin
    .from("results")
    .upsert(
      {
        student_id,
        class_id,
        subject_id,
        exam_type_id,
        marks_obtained,
        max_marks: maxMarks,
        grade,
        entered_by: user.id,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "student_id,subject_id,exam_type_id" }
    )
    .select("id, marks_obtained, max_marks, grade, is_published, updated_at")
    .single();
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ data: upserted });
}

// DELETE /api/results/by-student?id=...
// Deletes a single result row. Refuses if published.
export async function DELETE(request: NextRequest) {
  const auth = await verifyAdminOrEditorWithUser("results");
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { admin } = auth;

  const id = request.nextUrl.searchParams.get("id");
  if (!id) {
    return NextResponse.json({ error: "id is required" }, { status: 400 });
  }

  const { data: existing } = await admin
    .from("results")
    .select("id, is_published")
    .eq("id", id)
    .maybeSingle();
  if (!existing) {
    return NextResponse.json({ error: "Result not found" }, { status: 404 });
  }
  if (existing.is_published) {
    return NextResponse.json(
      {
        error: "This result is published. Unlock it before deleting.",
        code: "PUBLISHED_LOCKED",
      },
      { status: 409 }
    );
  }

  const { error } = await admin.from("results").delete().eq("id", id);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ success: true });
}

const unlockSchema = z.object({
  scope: z.enum(["row", "exam"]),
  // For scope=row: the result row id.
  result_id: z.string().uuid().optional(),
  // For scope=exam: surgical unlock of all rows for one student × one exam.
  student_id: z.string().uuid().optional(),
  exam_type_id: z.string().uuid().optional(),
});

// PATCH /api/results/by-student
// Surgical unlock: flips is_published=false for either a single row or all
// rows for one (student, exam) — the "A1" workflow. Avoids the class-wide
// unpublish toggle on /erp/exams/publish for one-off corrections.
export async function PATCH(request: NextRequest) {
  const auth = await verifyAdminOrEditorWithUser("results");
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { admin, user } = auth;

  const body = await request.json();
  const parsed = unlockSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid data", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  let query = admin.from("results").update({
    is_published: false,
    updated_at: new Date().toISOString(),
  });

  let scopeNote = "";
  let classId: string | null = null;
  let examTypeId: string | null = null;

  if (parsed.data.scope === "row") {
    if (!parsed.data.result_id) {
      return NextResponse.json({ error: "result_id required for scope=row" }, { status: 400 });
    }
    const { data: row } = await admin
      .from("results")
      .select("class_id, exam_type_id")
      .eq("id", parsed.data.result_id)
      .maybeSingle();
    classId = (row?.class_id as string | null) ?? null;
    examTypeId = (row?.exam_type_id as string | null) ?? null;
    query = query.eq("id", parsed.data.result_id);
    scopeNote = `Surgical unlock of result ${parsed.data.result_id}`;
  } else {
    if (!parsed.data.student_id || !parsed.data.exam_type_id) {
      return NextResponse.json(
        { error: "student_id + exam_type_id required for scope=exam" },
        { status: 400 }
      );
    }
    examTypeId = parsed.data.exam_type_id;
    const { data: anyRow } = await admin
      .from("results")
      .select("class_id")
      .eq("student_id", parsed.data.student_id)
      .eq("exam_type_id", parsed.data.exam_type_id)
      .limit(1)
      .maybeSingle();
    classId = (anyRow?.class_id as string | null) ?? null;
    query = query
      .eq("student_id", parsed.data.student_id)
      .eq("exam_type_id", parsed.data.exam_type_id);
    scopeNote = `Surgical unlock for student ${parsed.data.student_id}, exam ${parsed.data.exam_type_id}`;
  }

  const { data: updated, error } = await query.select("id");
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  const affected = updated?.length ?? 0;

  if (affected > 0 && classId && examTypeId) {
    await admin.from("publish_events").insert({
      event_type: "unpublish_results",
      class_id: classId,
      exam_type_id: examTypeId,
      actor_id: user.id,
      note: `${scopeNote} — ${affected} row${affected === 1 ? "" : "s"}`,
    });
  }

  return NextResponse.json({ success: true, affected });
}
