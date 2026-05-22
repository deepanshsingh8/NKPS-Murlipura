// White Sheet data builder — reused by the White Sheet (single exam)
// endpoints and by Green Sheet (per-exam slice for each applicable exam).
//
// Given a class + exam_type, returns:
//   - subjects ordered and typed by result_master_subjects.role (main/optional)
//     if a result_master exists for (class, academic_year); otherwise falls
//     back to all class_subjects, all treated as 'main'.
//   - rows per student: per-subject marks, main total, optional total,
//     grand total, percentage, grade.
//   - show_extra_separately flag so the renderer can split or merge the
//     optional subjects section.
//
// Missing results surface as blank cells — the sheet doubles as a gap audit.

import type { SupabaseClient } from "@supabase/supabase-js";
import { computeGrade, resolveGradeScaleForClass } from "@/lib/grading";

export type SubjectRole = "main" | "optional";

export interface WhiteSheetSubject {
  subject_id: string;
  name: string;
  code: string | null;
  role: SubjectRole;
  sort_order: number;
  max_marks: number;
}

export interface WhiteSheetStudentRow {
  student_id: string;
  roll_number: number | null;
  admission_no: string;
  full_name: string;
  marks_by_subject: Record<string, number | null>;
  main_obtained: number;
  main_max: number;
  optional_obtained: number;
  optional_max: number;
  total_obtained: number;
  total_max: number;
  percentage: number | null;
  grade: string | null;
}

export interface WhiteSheetMeta {
  class_id: string;
  class_name: string;
  section: string | null;
  academic_year_id: string;
  exam_type_id: string;
  exam_name: string;
  exam_max_marks: number;
  show_extra_separately: boolean;
  has_result_master: boolean;
}

export interface WhiteSheetData {
  meta: WhiteSheetMeta;
  subjects: WhiteSheetSubject[];
  rows: WhiteSheetStudentRow[];
}

export async function buildWhiteSheetData(
  supabase: SupabaseClient,
  classId: string,
  examTypeId: string
): Promise<WhiteSheetData | null> {
  const [{ data: cls }, { data: exam }] = await Promise.all([
    supabase
      .from("classes")
      .select("id, name, section, academic_year_id")
      .eq("id", classId)
      .maybeSingle(),
    supabase
      .from("exam_types")
      .select("id, name, max_marks")
      .eq("id", examTypeId)
      .maybeSingle(),
  ]);
  if (!cls || !exam) return null;

  // Result master for this (class, year) — optional. When missing, sheet
  // treats every class_subjects row as 'main' so it still renders.
  const { data: masterRow } = await supabase
    .from("result_masters")
    .select("id, show_extra_separately")
    .eq("class_id", cls.id)
    .eq("academic_year_id", cls.academic_year_id)
    .maybeSingle();

  let subjects: WhiteSheetSubject[] = [];

  if (masterRow?.id) {
    const { data: masterSubjects } = await supabase
      .from("result_master_subjects")
      .select(
        "subject_id, role, sort_order, subjects(id, name, code, is_active)"
      )
      .eq("result_master_id", masterRow.id)
      .order("role", { ascending: true })
      .order("sort_order", { ascending: true });

    subjects = (masterSubjects ?? [])
      .map((row) => {
        const sub = row.subjects as unknown as {
          id: string;
          name: string;
          code: string | null;
          is_active: boolean;
        } | null;
        if (!sub) return null;
        return {
          subject_id: sub.id,
          name: sub.name,
          code: sub.code ?? null,
          role: (row.role as SubjectRole) ?? "main",
          sort_order: (row.sort_order as number) ?? 0,
          max_marks: exam.max_marks as number,
        };
      })
      .filter((s): s is WhiteSheetSubject => Boolean(s));
  } else {
    const { data: classSubjects } = await supabase
      .from("class_subjects")
      .select("subjects(id, name, code, is_active)")
      .eq("class_id", cls.id);

    const mapped: (WhiteSheetSubject | null)[] = (classSubjects ?? []).map(
      (row) => {
        const sub = row.subjects as unknown as {
          id: string;
          name: string;
          code: string | null;
          is_active: boolean;
        } | null;
        if (!sub) return null;
        return {
          subject_id: sub.id,
          name: sub.name,
          code: sub.code ?? null,
          role: "main",
          sort_order: 0,
          max_marks: exam.max_marks as number,
        };
      }
    );
    subjects = mapped
      .filter((s): s is WhiteSheetSubject => s !== null)
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  // Enrollments for this class — active only, ordered by roll for on-screen
  // alignment with admit cards / marks-entry grid.
  const { data: enrollments } = await supabase
    .from("student_enrollments")
    .select("student_id, roll_number, students(id, full_name, admission_no)")
    .eq("class_id", cls.id)
    .eq("status", "active")
    .order("roll_number", { ascending: true, nullsFirst: false });

  const studentRows = (enrollments ?? []).map((e) => {
    const s = e.students as unknown as {
      id: string;
      full_name: string;
      admission_no: string;
    } | null;
    return {
      student_id: s?.id ?? (e.student_id as string),
      roll_number: (e.roll_number as number | null) ?? null,
      admission_no: s?.admission_no ?? "",
      full_name: s?.full_name ?? "",
    };
  });

  const studentIds = studentRows.map((r) => r.student_id);

  // Pull all result rows for (class × exam). We filter on subject_id too so
  // stray rows for subjects no longer on the master don't leak into totals.
  const subjectIds = subjects.map((s) => s.subject_id);
  let results: Array<{
    student_id: string;
    subject_id: string;
    marks_obtained: number;
    max_marks: number;
  }> = [];

  if (subjectIds.length > 0 && studentIds.length > 0) {
    const { data } = await supabase
      .from("results")
      .select("student_id, subject_id, marks_obtained, max_marks")
      .eq("class_id", classId)
      .eq("exam_type_id", examTypeId)
      .in("subject_id", subjectIds)
      .in("student_id", studentIds);
    results = (data ?? []) as typeof results;
  }

  const bySubjectByStudent = new Map<string, Map<string, (typeof results)[0]>>();
  for (const r of results) {
    if (!bySubjectByStudent.has(r.student_id)) {
      bySubjectByStudent.set(r.student_id, new Map());
    }
    bySubjectByStudent.get(r.student_id)!.set(r.subject_id, r);
  }

  const gradeScale = await resolveGradeScaleForClass(
    supabase,
    cls.id,
    "scholastic"
  );

  const rows: WhiteSheetStudentRow[] = studentRows.map((r) => {
    const subjectMap = bySubjectByStudent.get(r.student_id);
    const marksBySubject: Record<string, number | null> = {};
    let mainObtained = 0;
    let mainMax = 0;
    let optionalObtained = 0;
    let optionalMax = 0;

    for (const s of subjects) {
      const marks = subjectMap?.get(s.subject_id);
      if (marks) {
        marksBySubject[s.subject_id] = marks.marks_obtained;
        if (s.role === "main") {
          mainObtained += marks.marks_obtained;
          mainMax += marks.max_marks;
        } else {
          optionalObtained += marks.marks_obtained;
          optionalMax += marks.max_marks;
        }
      } else {
        marksBySubject[s.subject_id] = null;
      }
    }

    const totalObtained = mainObtained + optionalObtained;
    const totalMax = mainMax + optionalMax;
    const pct = totalMax > 0 ? (totalObtained / totalMax) * 100 : null;
    const grade =
      pct !== null && gradeScale ? computeGrade(pct, gradeScale.bands) : null;

    return {
      student_id: r.student_id,
      roll_number: r.roll_number,
      admission_no: r.admission_no,
      full_name: r.full_name,
      marks_by_subject: marksBySubject,
      main_obtained: mainObtained,
      main_max: mainMax,
      optional_obtained: optionalObtained,
      optional_max: optionalMax,
      total_obtained: totalObtained,
      total_max: totalMax,
      percentage: pct,
      grade,
    };
  });

  return {
    meta: {
      class_id: cls.id as string,
      class_name: cls.name as string,
      section: (cls.section as string | null) ?? null,
      academic_year_id: cls.academic_year_id as string,
      exam_type_id: exam.id as string,
      exam_name: exam.name as string,
      exam_max_marks: exam.max_marks as number,
      show_extra_separately: Boolean(masterRow?.show_extra_separately),
      has_result_master: Boolean(masterRow?.id),
    },
    subjects,
    rows,
  };
}
