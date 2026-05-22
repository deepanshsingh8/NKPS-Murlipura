import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@nkps/shared/lib/supabase/server";
import { contentDispositionAttachment } from "@nkps/shared/lib/utils";

function csvEscape(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "";
  const s = String(value);
  if (s.includes(",") || s.includes('"') || s.includes("\n")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function safeFilename(...parts: string[]): string {
  return parts
    .filter(Boolean)
    .join("_")
    .replace(/[^\w\-]+/g, "_")
    .replace(/_+/g, "_");
}

// GET /api/results/export?class_id&exam_type_id&subject_id
// Returns a CSV with one row per enrolled student and their current marks
// (blank if not yet entered) for the chosen class + subject + exam.
export async function GET(request: NextRequest) {
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
      .eq("feature_key", "results")
      .maybeSingle();
    if (!perm) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
  }

  const params = request.nextUrl.searchParams;
  const classId = params.get("class_id");
  const examTypeId = params.get("exam_type_id");
  const subjectId = params.get("subject_id");

  if (!classId || !examTypeId || !subjectId) {
    return NextResponse.json(
      { error: "class_id, exam_type_id, and subject_id are required" },
      { status: 400 }
    );
  }

  const [{ data: cls }, { data: exam }, { data: subject }] = await Promise.all([
    supabase.from("classes").select("name, section").eq("id", classId).maybeSingle(),
    supabase
      .from("exam_types")
      .select("name, max_marks")
      .eq("id", examTypeId)
      .maybeSingle(),
    supabase.from("subjects").select("name, code").eq("id", subjectId).maybeSingle(),
  ]);

  if (!cls || !exam || !subject) {
    return NextResponse.json(
      { error: "Class, exam type, or subject not found" },
      { status: 404 }
    );
  }

  const { data: enrollments } = await supabase
    .from("student_enrollments")
    .select("student_id, roll_number, students(full_name, admission_no)")
    .eq("class_id", classId)
    .eq("status", "active")
    .order("roll_number", { ascending: true });

  const enrolled = (enrollments ?? []).map((e) => ({
    student_id: e.student_id as string,
    roll_number: (e.roll_number as number | null) ?? null,
    full_name:
      (e.students as unknown as { full_name: string; admission_no: string })
        ?.full_name ?? "",
    admission_no:
      (e.students as unknown as { full_name: string; admission_no: string })
        ?.admission_no ?? "",
  }));

  const studentIds = enrolled.map((s) => s.student_id);
  const { data: existingResults } = await supabase
    .from("results")
    .select("student_id, marks_obtained, max_marks, grade")
    .eq("subject_id", subjectId)
    .eq("exam_type_id", examTypeId)
    .in("student_id", studentIds.length > 0 ? studentIds : ["__none__"]);

  const byStudent = new Map<
    string,
    { marks_obtained: number; max_marks: number; grade: string | null }
  >();
  for (const r of existingResults ?? []) {
    byStudent.set(r.student_id as string, {
      marks_obtained: r.marks_obtained as number,
      max_marks: r.max_marks as number,
      grade: (r.grade as string | null) ?? null,
    });
  }

  const headerRow = [
    "admission_no",
    "roll_number",
    "student_name",
    "marks_obtained",
    "max_marks",
    "grade",
  ];

  const lines: string[] = [headerRow.join(",")];
  for (const s of enrolled) {
    const existing = byStudent.get(s.student_id);
    lines.push(
      [
        csvEscape(s.admission_no),
        csvEscape(s.roll_number),
        csvEscape(s.full_name),
        csvEscape(existing?.marks_obtained ?? ""),
        csvEscape(existing?.max_marks ?? exam.max_marks),
        csvEscape(existing?.grade ?? ""),
      ].join(",")
    );
  }

  const csv = lines.join("\n");
  const filename = safeFilename(
    "marks",
    cls.name ?? "",
    cls.section ?? "",
    subject.code ?? subject.name ?? "",
    exam.name ?? ""
  );

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": contentDispositionAttachment(`${filename}.csv`),
      "Cache-Control": "no-store",
    },
  });
}
