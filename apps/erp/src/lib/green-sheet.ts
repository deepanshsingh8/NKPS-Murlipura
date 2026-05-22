// Green Sheet data builder — consolidated year-end view per class.
//
// Rows = students (ordered by roll).
// Cols = one block per applicable exam (obtained / max / %) + final-result
// summary (main total %, grade, rank when the master opts in).
//
// "Applicable" is whatever `class_exam_configs.is_applicable` marks true
// for this class — same filter the final-result compute uses, so the
// per-exam totals visible on the sheet line up with what rolls into the
// final result.

import type { SupabaseClient } from "@supabase/supabase-js";
import { computeFinalResult, computeRanksForClass } from "@/lib/final-result";
import type { FinalResult } from "@nkps/shared/types";

export interface GreenSheetExam {
  exam_type_id: string;
  exam_name: string;
  max_marks: number;
  weightage: number | null;
  sort_order: number;
}

export interface GreenSheetStudentExamCell {
  total_obtained: number;
  total_max: number;
  percentage: number | null;
}

export interface GreenSheetStudentRow {
  student_id: string;
  roll_number: number | null;
  admission_no: string;
  full_name: string;
  per_exam: Record<string, GreenSheetStudentExamCell>;
  final: FinalResult | null;
}

export interface GreenSheetMeta {
  class_id: string;
  class_name: string;
  section: string | null;
  academic_year_id: string;
  academic_year_label: string;
  has_result_master: boolean;
  show_rank: boolean;
}

export interface GreenSheetData {
  meta: GreenSheetMeta;
  exams: GreenSheetExam[];
  rows: GreenSheetStudentRow[];
}

export async function buildGreenSheetData(
  supabase: SupabaseClient,
  classId: string,
  academicYearId: string
): Promise<GreenSheetData | null> {
  const [{ data: cls }, { data: year }] = await Promise.all([
    supabase
      .from("classes")
      .select("id, name, section, academic_year_id")
      .eq("id", classId)
      .maybeSingle(),
    supabase
      .from("academic_years")
      .select("id, name")
      .eq("id", academicYearId)
      .maybeSingle(),
  ]);
  if (!cls || !year) return null;
  if (cls.academic_year_id !== year.id) {
    // Silently reject cross-year inputs — caller mistake, not a data issue.
    return null;
  }

  // Result master is optional; without it, final compute returns null for
  // every student and we'll just show the per-exam columns.
  const { data: masterRow } = await supabase
    .from("result_masters")
    .select("id, show_rank")
    .eq("class_id", cls.id)
    .eq("academic_year_id", year.id)
    .maybeSingle();

  const { data: examConfigs } = await supabase
    .from("class_exam_configs")
    .select(
      "exam_type_id, weightage, sort_order, exam_types(id, name, max_marks, academic_year_id)"
    )
    .eq("class_id", cls.id)
    .eq("is_applicable", true)
    .order("sort_order", { ascending: true });

  const exams: GreenSheetExam[] = (examConfigs ?? [])
    .map((row) => {
      const et = row.exam_types as unknown as {
        id: string;
        name: string;
        max_marks: number;
        academic_year_id: string;
      } | null;
      if (!et || et.academic_year_id !== year.id) return null;
      return {
        exam_type_id: et.id,
        exam_name: et.name,
        max_marks: et.max_marks,
        weightage:
          row.weightage === null || row.weightage === undefined
            ? null
            : Number(row.weightage),
        sort_order: (row.sort_order as number) ?? 0,
      };
    })
    .filter((e): e is GreenSheetExam => e !== null);

  // Enrollments
  const { data: enrollments } = await supabase
    .from("student_enrollments")
    .select("student_id, roll_number, students(id, full_name, admission_no)")
    .eq("class_id", cls.id)
    .eq("status", "active")
    .order("roll_number", { ascending: true, nullsFirst: false });

  const students = (enrollments ?? []).map((e) => {
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

  const studentIds = students.map((s) => s.student_id);
  const examTypeIds = exams.map((e) => e.exam_type_id);

  // Pull all results in one sweep across students × applicable exams.
  let results: Array<{
    student_id: string;
    exam_type_id: string;
    marks_obtained: number;
    max_marks: number;
  }> = [];
  if (studentIds.length > 0 && examTypeIds.length > 0) {
    const { data } = await supabase
      .from("results")
      .select("student_id, exam_type_id, marks_obtained, max_marks")
      .eq("class_id", cls.id)
      .in("student_id", studentIds)
      .in("exam_type_id", examTypeIds);
    results = (data ?? []) as typeof results;
  }

  // Aggregate per-student per-exam totals.
  const totals = new Map<
    string,
    Map<string, { obtained: number; max: number }>
  >();
  for (const r of results) {
    if (!totals.has(r.student_id)) totals.set(r.student_id, new Map());
    const perExam = totals.get(r.student_id)!;
    const agg = perExam.get(r.exam_type_id) ?? { obtained: 0, max: 0 };
    agg.obtained += Number(r.marks_obtained);
    agg.max += Number(r.max_marks);
    perExam.set(r.exam_type_id, agg);
  }

  // Final result per student — computeFinalResult returns null without a
  // master or when the student has zero recorded marks. We accept both.
  const finalByStudent = new Map<string, FinalResult | null>();
  if (masterRow?.id && studentIds.length > 0) {
    const settled = await Promise.all(
      studentIds.map((sid) =>
        computeFinalResult(supabase, {
          student_id: sid,
          academic_year_id: year.id,
        }).then((r) => [sid, r] as const)
      )
    );
    for (const [sid, r] of settled) finalByStudent.set(sid, r);
  }

  // Rank overlay (separate O(N) compute — only when master opts in).
  let rankBy: Map<string, number> | null = null;
  if (masterRow?.show_rank) {
    rankBy = await computeRanksForClass(supabase, {
      class_id: cls.id,
      academic_year_id: year.id,
    });
  }

  const rows: GreenSheetStudentRow[] = students.map((s) => {
    const perExamAgg = totals.get(s.student_id);
    const perExam: Record<string, GreenSheetStudentExamCell> = {};
    for (const exam of exams) {
      const agg = perExamAgg?.get(exam.exam_type_id);
      if (agg && agg.max > 0) {
        perExam[exam.exam_type_id] = {
          total_obtained: agg.obtained,
          total_max: agg.max,
          percentage: (agg.obtained / agg.max) * 100,
        };
      } else {
        perExam[exam.exam_type_id] = {
          total_obtained: 0,
          total_max: 0,
          percentage: null,
        };
      }
    }

    let final = finalByStudent.get(s.student_id) ?? null;
    if (final && rankBy) {
      final = { ...final, rank: rankBy.get(s.student_id) ?? null };
    }

    return {
      student_id: s.student_id,
      roll_number: s.roll_number,
      admission_no: s.admission_no,
      full_name: s.full_name,
      per_exam: perExam,
      final,
    };
  });

  return {
    meta: {
      class_id: cls.id as string,
      class_name: cls.name as string,
      section: (cls.section as string | null) ?? null,
      academic_year_id: year.id as string,
      academic_year_label: (year.name as string) ?? "",
      has_result_master: Boolean(masterRow?.id),
      show_rank: Boolean(masterRow?.show_rank),
    },
    exams,
    rows,
  };
}
