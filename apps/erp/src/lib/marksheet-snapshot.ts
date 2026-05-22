// Snapshot builder for finalized marksheets (Phase 5).
//
// A "snapshot" captures everything the ReportCardPDF component needs to
// render a single student's report card for a specific (class, exam) pair.
// Once finalized, the PDF route serves from the snapshot so future mark
// edits don't mutate distributed marksheets.
//
// Schema version bumps whenever the shape changes; the renderer branches on
// version to stay backward-compatible with older saved snapshots.

import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  ReportCardAttendance,
  ReportCardExamGroup,
  ReportCardStudent,
} from "@/lib/report-card";
import { getReportCardData } from "@/lib/report-card";
import { getPdfTemplate } from "@/lib/pdf-templates";
import type { PdfFooter } from "@/lib/pdf-templates";
import { computeFinalResult, computeRanksForClass } from "@/lib/final-result";
import type { FinalResult } from "@nkps/shared/types";

export const MARKSHEET_SCHEMA_VERSION = "v1";

export interface MarksheetSnapshotSchool {
  name: string;
  addressLine: string;
  affiliation: string;
  affiliationNumber: string;
}

export interface MarksheetSnapshotV1 {
  schema_version: "v1";
  student: ReportCardStudent;
  exam: ReportCardExamGroup;
  attendance: ReportCardAttendance | null;
  school: MarksheetSnapshotSchool;
  footer: PdfFooter;
  generated_on_iso: string;
}

// V2 — year-final aggregate. Captures the result-master computation and the
// metadata the PDF route needs to render in final-result mode without
// recomputing.
//
// **V2 is render-only.** `final_result` is the already-computed output;
// nothing in the renderer reads or recomputes from `pass_mark_mode`,
// `pass_criteria_type`, or `grace_*` at PDF time. The render flags below are
// intentionally a narrow subset of `ResultMaster` — only what controls the
// visual layout. If you ever need to change a *computational* default, do
// NOT smuggle that decision through the snapshot; recompute against the live
// master and re-finalize. Mixing fresh master rules with a frozen
// `final_result` would silently diverge from what was published. (M13.)
export interface MarksheetSnapshotV2 {
  schema_version: "v2";
  kind: "year_final";
  student: ReportCardStudent;
  attendance: ReportCardAttendance | null;
  final_result: FinalResult;
  result_master: {
    include_non_scholastic: boolean;
    non_scholastic_placement: "below" | "above" | "separate_page";
    show_extra_separately: boolean;
    show_rank: boolean;
  };
  year_label: string;
  school: MarksheetSnapshotSchool;
  footer: PdfFooter;
  generated_on_iso: string;
}

/**
 * Build a snapshot for a single student × exam. Returns null when there's
 * no matching data (e.g. student has no published marks yet — the caller
 * should skip rather than store an empty snapshot).
 */
export async function buildMarksheetSnapshot(
  supabase: SupabaseClient,
  studentId: string,
  examTypeId: string
): Promise<MarksheetSnapshotV1 | null> {
  // includeUnpublished=true so finalize works before online publish happens
  // (admin flow: generate official printed marksheets ahead of portal release).
  const data = await getReportCardData(supabase, studentId, null, {
    includeUnpublished: true,
  });
  if (!data) return null;

  const exam = data.exams.find((e) => e.exam_type_id === examTypeId);
  if (!exam) return null;

  const { header, footer } = await getPdfTemplate(supabase, "report_card");

  return {
    schema_version: "v1",
    student: data.student,
    exam,
    attendance: data.attendance,
    school: {
      name: header.school_name,
      addressLine: header.address_line,
      affiliation: header.affiliation ?? "",
      affiliationNumber: header.affiliation_number ?? "",
    },
    footer,
    generated_on_iso: new Date().toISOString(),
  };
}

/**
 * Build a year-final snapshot. Returns null when:
 *   - the student isn't actively enrolled in any class for `academicYearId`,
 *   - no `result_master` is configured for that (class, year), or
 *   - `computeFinalResult` returns null (no marks recorded yet, or zero main
 *     subjects in the master).
 *
 * The snapshot deliberately captures rank-as-of-finalize-time. A student
 * whose rank changes due to peers being re-graded later won't see their
 * frozen marksheet update — which is the whole point of finalize.
 */
export async function buildYearFinalSnapshot(
  supabase: SupabaseClient,
  studentId: string,
  academicYearId: string
): Promise<MarksheetSnapshotV2 | null> {
  // Multi-enrollment guard: if the student has more than one active row for
  // the year, the finalize path MUST stop and force the admin to resolve
  // before snapshotting. Silently picking one would freeze the wrong class
  // into the snapshot. Throw a recognizable error so the finalize loop can
  // catch it and surface a per-student message instead of failing silently.
  const { data: enrollments } = await supabase
    .from("student_enrollments")
    .select("class_id")
    .eq("student_id", studentId)
    .eq("academic_year_id", academicYearId)
    .eq("status", "active");
  if (!enrollments || enrollments.length === 0) return null;
  if (enrollments.length > 1) {
    throw new Error(
      `Student has ${enrollments.length} active enrollments for this year — set all but one to inactive before finalizing.`
    );
  }
  const classId = enrollments[0].class_id as string;

  const { data: master } = await supabase
    .from("result_masters")
    .select(
      "id, include_non_scholastic, non_scholastic_placement, show_extra_separately, show_rank"
    )
    .eq("class_id", classId)
    .eq("academic_year_id", academicYearId)
    .maybeSingle();
  if (!master) return null;

  const finalResult = await computeFinalResult(supabase, {
    student_id: studentId,
    academic_year_id: academicYearId,
  });
  if (!finalResult) return null;

  let withRank: FinalResult = finalResult;
  if (master.show_rank) {
    const ranks = await computeRanksForClass(supabase, {
      class_id: classId,
      academic_year_id: academicYearId,
    });
    withRank = { ...finalResult, rank: ranks.get(studentId) ?? null };
  }

  // Reuse getReportCardData for the student/attendance shape. We pass the
  // year explicitly so attendance is filtered correctly even after the
  // current academic-year flag rolls over.
  const data = await getReportCardData(supabase, studentId, academicYearId, {
    includeUnpublished: true,
  });
  if (!data) return null;

  const { data: yearRow } = await supabase
    .from("academic_years")
    .select("name")
    .eq("id", academicYearId)
    .maybeSingle();
  const yearLabel = (yearRow?.name as string | undefined) ?? "year";

  const { header, footer } = await getPdfTemplate(supabase, "report_card");

  return {
    schema_version: "v2",
    kind: "year_final",
    student: data.student,
    attendance: data.attendance,
    final_result: withRank,
    result_master: {
      include_non_scholastic: Boolean(master.include_non_scholastic),
      non_scholastic_placement: master.non_scholastic_placement as
        | "below"
        | "above"
        | "separate_page",
      show_extra_separately: Boolean(master.show_extra_separately),
      show_rank: Boolean(master.show_rank),
    },
    year_label: yearLabel,
    school: {
      name: header.school_name,
      addressLine: header.address_line,
      affiliation: header.affiliation ?? "",
      affiliationNumber: header.affiliation_number ?? "",
    },
    footer,
    generated_on_iso: new Date().toISOString(),
  };
}
