import { NextResponse } from "next/server";
import { renderToBuffer } from "@react-pdf/renderer";
import { promises as fs } from "fs";
import path from "path";
import { createClient } from "@nkps/shared/lib/supabase/server";
import { createAdminClient } from "@nkps/shared/lib/supabase/admin";
import { canViewReportCard, getReportCardData } from "@/lib/report-card";
import type { ReportCardExamGroup } from "@/lib/report-card";
import { ReportCardPDF } from "@/components/pdf/ReportCardPDF";
import { getPdfTemplate } from "@/lib/pdf-templates";
import { contentDispositionAttachment } from "@nkps/shared/lib/utils";
import {
  computeFinalResult,
  computeRanksForClass,
} from "@/lib/final-result";
import type { FinalResult } from "@nkps/shared/types";
import type {
  MarksheetSnapshotV1,
  MarksheetSnapshotV2,
} from "@/lib/marksheet-snapshot";

export const runtime = "nodejs";

// Cache the logo bytes across invocations in the same Node process.
let cachedLogo: Buffer | null = null;
async function loadLogo(): Promise<Buffer | null> {
  if (cachedLogo) return cachedLogo;
  try {
    const logoPath = path.join(process.cwd(), "public", "images", "logo.png");
    cachedLogo = await fs.readFile(logoPath);
    return cachedLogo;
  } catch (err) {
    console.warn("Report card: logo not found, PDF will render without it", err);
    return null;
  }
}

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
    const studentId = searchParams.get("student_id");
    const examTypeId = searchParams.get("exam_type_id");
    const academicYearId = searchParams.get("academic_year_id");

    if (!studentId) {
      return NextResponse.json(
        { error: "student_id is required" },
        { status: 400 }
      );
    }

    // Mode selection: legacy if exam_type_id is present, final-result if
    // academic_year_id is present without exam_type_id. At least one scope
    // must be specified.
    if (!examTypeId && !academicYearId) {
      return NextResponse.json(
        {
          error:
            "Either exam_type_id (legacy per-exam) or academic_year_id (final-result) is required",
        },
        { status: 400 }
      );
    }

    const allowed = await canViewReportCard(supabase, user.id, studentId);
    if (!allowed) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // Caller-role gate (audit H2): students/parents only see published marks
    // through the live-compute path. The snapshot path (read further down)
    // is unaffected because finalized snapshots are by definition published.
    const { data: callerProfile } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .single();
    const callerRole = (callerProfile?.role as string | undefined) ?? "";
    const callerIsStaff =
      callerRole === "admin" ||
      callerRole === "staff" ||
      callerRole === "teacher";

    const generatedOn = new Date().toLocaleString("en-IN", {
      timeZone: "Asia/Kolkata",
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });

    const logoData = await loadLogo();
    const { header, footer } = await getPdfTemplate(supabase, "report_card");

    // =============================================================
    // Legacy mode — byte-identical to the pre-Phase-3 path.
    // =============================================================
    if (examTypeId) {
      // Phase 5: if a finalized marksheet exists for (student, exam), render
      // from its stored snapshot so edits after finalization don't mutate
      // distributed marksheets. Uses the admin client to bypass RLS — access
      // was already gated via canViewReportCard above.
      const adminClient = createAdminClient();
      const { data: activeRow } = await adminClient
        .from("marksheet_publications")
        .select("snapshot, schema_version, version, published_at")
        .eq("student_id", studentId)
        .eq("exam_type_id", examTypeId)
        .is("unpublished_at", null)
        .order("version", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (activeRow?.snapshot) {
        // Reject snapshots whose schema version we don't know how to render.
        // The marksheet_publications.schema_version column is the source of
        // truth (the JSON's own field is informational); falling back to the
        // JSON if the column is null lets older rows still render.
        const snapRaw = activeRow.snapshot as { schema_version?: string };
        const declaredVersion =
          (activeRow.schema_version as string | null) ??
          snapRaw.schema_version ??
          null;
        if (declaredVersion !== "v1") {
          return NextResponse.json(
            {
              error: `Unsupported marksheet snapshot version (${declaredVersion ?? "unknown"}). Re-finalize this marksheet to upgrade.`,
            },
            { status: 422 }
          );
        }
        const snap = activeRow.snapshot as MarksheetSnapshotV1;
        const snapGeneratedOn = new Date(snap.generated_on_iso).toLocaleString(
          "en-IN",
          {
            timeZone: "Asia/Kolkata",
            day: "2-digit",
            month: "short",
            year: "numeric",
            hour: "2-digit",
            minute: "2-digit",
          }
        );
        const buffer = await renderToBuffer(
          <ReportCardPDF
            school={snap.school}
            student={snap.student}
            exam={snap.exam}
            attendance={snap.attendance}
            logoData={logoData ?? undefined}
            generatedOn={snapGeneratedOn}
            footer={snap.footer}
          />
        );
        const safeName = snap.student.name.replace(/[^\w\-]+/g, "_");
        const safeExam = snap.exam.exam_type_name.replace(/[^\w\-]+/g, "_");
        const filename = `report-card_${safeName}_${safeExam}_v${activeRow.version}.pdf`;
        return new NextResponse(new Uint8Array(buffer), {
          status: 200,
          headers: {
            "Content-Type": "application/pdf",
            "Content-Disposition": contentDispositionAttachment(filename),
            "Cache-Control": "private, no-store",
            "X-Marksheet-Source": "finalized-snapshot",
            "X-Marksheet-Version": String(activeRow.version),
          },
        });
      }

      // Legacy per-exam branch: attendance is computed via
      // `academic_years.is_current` inside getReportCardData; passing an
      // explicit academicYearId here would mis-filter attendance to a year
      // that may not be the current one. Always pass null in legacy mode.
      const data = await getReportCardData(supabase, studentId, null);
      if (!data) {
        return NextResponse.json({ error: "Student not found" }, { status: 404 });
      }

      const exam = data.exams.find((e) => e.exam_type_id === examTypeId);
      if (!exam) {
        return NextResponse.json(
          { error: "No published results for this exam" },
          { status: 404 }
        );
      }

      const buffer = await renderToBuffer(
        <ReportCardPDF
          school={{
            name: header.school_name,
            addressLine: header.address_line,
            affiliation: header.affiliation ?? "",
            affiliationNumber: header.affiliation_number ?? "",
          }}
          student={data.student}
          exam={exam}
          attendance={data.attendance}
          logoData={logoData ?? undefined}
          generatedOn={generatedOn}
          footer={footer}
        />
      );

      const safeName = data.student.name.replace(/[^\w\-]+/g, "_");
      const safeExam = exam.exam_type_name.replace(/[^\w\-]+/g, "_");
      const filename = `report-card_${safeName}_${safeExam}.pdf`;

      return new NextResponse(new Uint8Array(buffer), {
        status: 200,
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": `attachment; filename="${filename}"`,
          "Cache-Control": "private, no-store",
        },
      });
    }

    // =============================================================
    // Final-result mode — Phase 3.
    // =============================================================
    // Non-null assertion guard: academicYearId is guaranteed present here
    // (400 guard above rejects the both-absent case, legacy branch handles
    // examTypeId).
    const yearId = academicYearId!;

    // Year-final snapshot has priority. If an admin has finalized for this
    // (student, year), serve from the snapshot so the PDF is frozen — even
    // if marks have changed since.
    {
      const adminClient = createAdminClient();
      const { data: yfRow } = await adminClient
        .from("marksheet_publications")
        .select("snapshot, schema_version, version, published_at")
        .eq("student_id", studentId)
        .eq("academic_year_id", yearId)
        .eq("kind", "year_final")
        .is("unpublished_at", null)
        .order("version", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (yfRow?.snapshot) {
        const declared =
          (yfRow.schema_version as string | null) ??
          (yfRow.snapshot as { schema_version?: string }).schema_version ??
          null;
        if (declared !== "v2") {
          return NextResponse.json(
            {
              error: `Unsupported year-final snapshot version (${declared ?? "unknown"}). Re-finalize this marksheet to upgrade.`,
            },
            { status: 422 }
          );
        }
        const snap = yfRow.snapshot as MarksheetSnapshotV2;
        const generatedOnLabel = new Date(snap.generated_on_iso).toLocaleString(
          "en-IN",
          {
            timeZone: "Asia/Kolkata",
            day: "2-digit",
            month: "short",
            year: "numeric",
            hour: "2-digit",
            minute: "2-digit",
          }
        );
        const virtualExamForSnap: ReportCardExamGroup = {
          exam_type_id: "__final_result__",
          exam_type_name: "Final Result",
          sort_order: 0,
          subjects: [],
          total_obtained: 0,
          total_max: 0,
          percentage: 0,
          overall_grade: snap.final_result.overall.grade ?? "",
          remark: null,
        };
        const buffer = await renderToBuffer(
          <ReportCardPDF
            school={snap.school}
            student={snap.student}
            exam={virtualExamForSnap}
            attendance={snap.attendance}
            logoData={logoData ?? undefined}
            generatedOn={generatedOnLabel}
            footer={snap.footer}
            finalResult={snap.final_result}
            resultMaster={snap.result_master}
          />
        );
        const safeName = snap.student.name.replace(/[^\w\-]+/g, "_");
        const safeYear = snap.year_label.replace(/[^\w\-]+/g, "_");
        const filename = `report-card_${safeName}_final-result_${safeYear}_v${yfRow.version}.pdf`;
        return new NextResponse(new Uint8Array(buffer), {
          status: 200,
          headers: {
            "Content-Type": "application/pdf",
            "Content-Disposition": contentDispositionAttachment(filename),
            "Cache-Control": "private, no-store",
            "X-Marksheet-Source": "year-final-snapshot",
            "X-Marksheet-Version": String(yfRow.version),
          },
        });
      }
    }

    // Resolve active enrollment for this (student, year). Missing enrollment
    // = 404 since we can't locate the student's class for this year.
    const { data: enrollment } = await supabase
      .from("student_enrollments")
      .select("class_id")
      .eq("student_id", studentId)
      .eq("academic_year_id", yearId)
      .eq("status", "active")
      .maybeSingle();

    if (!enrollment?.class_id) {
      return NextResponse.json(
        { error: "No active enrollment for this student in the given academic year" },
        { status: 404 }
      );
    }
    const classId = enrollment.class_id as string;

    // Load result_master for this (class, year). Missing → clearer 400 than
    // silently falling back to legacy, since caller didn't supply an exam.
    const { data: masterRow } = await supabase
      .from("result_masters")
      .select(
        "id, include_non_scholastic, non_scholastic_placement, show_extra_separately, show_rank"
      )
      .eq("class_id", classId)
      .eq("academic_year_id", yearId)
      .maybeSingle();

    if (!masterRow) {
      return NextResponse.json(
        {
          error:
            "No result master configured for this class/year — specify exam_type_id for a legacy per-exam report card.",
        },
        { status: 400 }
      );
    }

    // Compute final result for this student. Null = no recorded marks OR
    // config has zero main subjects (both surface as the same empty state).
    const finalResult = await computeFinalResult(supabase, {
      student_id: studentId,
      academic_year_id: yearId,
      includeUnpublished: callerIsStaff,
    });

    if (!finalResult) {
      return NextResponse.json(
        { error: "No results recorded for this student" },
        { status: 404 }
      );
    }

    // Attach rank only when the master opts in (N+1 cohort compute is
    // expensive; skip when not needed).
    let enriched: FinalResult = finalResult;
    if (masterRow.show_rank) {
      const ranks = await computeRanksForClass(supabase, {
        class_id: classId,
        academic_year_id: yearId,
      });
      const rank = ranks.get(studentId) ?? null;
      enriched = { ...finalResult, rank };
    }

    // Reuse getReportCardData for student header + attendance. Re-fetching
    // `.exams` here is a minor (~20ms) duplication versus the dedicated
    // compute above; keeps the diff minimal. Flagged as a follow-up.
    const data = await getReportCardData(supabase, studentId, yearId);
    if (!data) {
      return NextResponse.json({ error: "Student not found" }, { status: 404 });
    }

    // The PDF component still requires an `exam` prop (drives the
    // class-teacher remark block and Document title fallback). For
    // final-result mode we synthesize a virtual group — no single exam is
    // the "final" source of truth.
    const virtualExam: ReportCardExamGroup = {
      exam_type_id: "__final_result__",
      exam_type_name: "Final Result",
      sort_order: 0,
      subjects: [],
      total_obtained: 0,
      total_max: 0,
      percentage: 0,
      overall_grade: enriched.overall.grade ?? "",
      remark: null,
    };

    // Resolve the academic year label for the filename.
    const { data: yearRow } = await supabase
      .from("academic_years")
      .select("name")
      .eq("id", yearId)
      .maybeSingle();
    const yearLabel = (yearRow?.name as string | undefined) ?? "year";

    const resultMasterProp = {
      include_non_scholastic: Boolean(masterRow.include_non_scholastic),
      non_scholastic_placement: masterRow.non_scholastic_placement as
        | "below"
        | "above"
        | "separate_page",
      show_extra_separately: Boolean(masterRow.show_extra_separately),
      show_rank: Boolean(masterRow.show_rank),
    };

    // Resolve non-scholastic assessments for the year. Each (parent subject,
    // sub_subject) pair is folded into its most-recent published assessment
    // row (we sort by updated_at DESC so re-grades land in the report). When
    // include_non_scholastic is false on the master, we still skip the fetch
    // so admins who haven't enabled the section don't pay any cost.
    let nonScholasticGroups: Array<{
      parent_id: string;
      parent_name: string;
      sub_subjects: Array<{
        sub_subject_id: string;
        sub_subject_name: string;
        grade_label: string | null;
        remarks: string | null;
      }>;
    }> = [];
    if (resultMasterProp.include_non_scholastic) {
      // M9 — scope to the report's class so prior-year assessments don't
      // resurface on the current year's card. `class_id` IS the year scope
      // here (every class belongs to exactly one academic_year).
      const { data: assessments } = await supabase
        .from("non_scholastic_assessments")
        .select(
          `id, sub_subject_id, grade_label, remarks, is_published, updated_at,
           sub:non_scholastic_sub_subjects(id, name, sort_order, is_active,
             parent:non_scholastic_subjects(id, name, sort_order, is_active))`
        )
        .eq("student_id", studentId)
        .eq("class_id", classId)
        .eq("is_published", true)
        .order("updated_at", { ascending: false });
      type Row = {
        sub_subject_id: string;
        grade_label: string | null;
        remarks: string | null;
        sub:
          | {
              id: string;
              name: string;
              sort_order: number;
              is_active: boolean;
              parent:
                | {
                    id: string;
                    name: string;
                    sort_order: number;
                    is_active: boolean;
                  }
                | { id: string; name: string; sort_order: number; is_active: boolean }[]
                | null;
            }
          | { id: string; name: string; sort_order: number; is_active: boolean; parent: unknown }[]
          | null;
      };
      // Most-recent first; first occurrence per sub_subject_id wins.
      const seenSub = new Set<string>();
      type ParentBucket = {
        parent_id: string;
        parent_name: string;
        parent_sort: number;
        sub_subjects: Array<{
          sub_subject_id: string;
          sub_subject_name: string;
          sub_sort: number;
          grade_label: string | null;
          remarks: string | null;
        }>;
      };
      const byParent = new Map<string, ParentBucket>();
      for (const r of (assessments ?? []) as Row[]) {
        if (seenSub.has(r.sub_subject_id)) continue;
        seenSub.add(r.sub_subject_id);
        const sub = Array.isArray(r.sub) ? r.sub[0] : r.sub;
        if (!sub || !sub.is_active) continue;
        const parent = Array.isArray(sub.parent) ? sub.parent[0] : sub.parent;
        if (!parent || !parent.is_active) continue;
        const bucket: ParentBucket =
          byParent.get(parent.id) ?? {
            parent_id: parent.id,
            parent_name: parent.name,
            parent_sort: parent.sort_order ?? 0,
            sub_subjects: [] as ParentBucket["sub_subjects"],
          };
        bucket.sub_subjects.push({
          sub_subject_id: sub.id,
          sub_subject_name: sub.name,
          sub_sort: sub.sort_order ?? 0,
          grade_label: r.grade_label,
          remarks: r.remarks,
        });
        byParent.set(parent.id, bucket);
      }
      nonScholasticGroups = Array.from(byParent.values())
        .sort((a, b) => a.parent_sort - b.parent_sort || a.parent_name.localeCompare(b.parent_name))
        .map((b) => ({
          parent_id: b.parent_id,
          parent_name: b.parent_name,
          sub_subjects: b.sub_subjects
            .sort((x, y) => x.sub_sort - y.sub_sort || x.sub_subject_name.localeCompare(y.sub_subject_name))
            .map(({ sub_subject_id, sub_subject_name, grade_label, remarks }) => ({
              sub_subject_id,
              sub_subject_name,
              grade_label,
              remarks,
            })),
        }));
    }

    const buffer = await renderToBuffer(
      <ReportCardPDF
        school={{
          name: header.school_name,
          addressLine: header.address_line,
          affiliation: header.affiliation ?? "",
          affiliationNumber: header.affiliation_number ?? "",
        }}
        student={data.student}
        exam={virtualExam}
        attendance={data.attendance}
        logoData={logoData ?? undefined}
        generatedOn={generatedOn}
        footer={footer}
        finalResult={enriched}
        resultMaster={resultMasterProp}
        nonScholasticGroups={nonScholasticGroups}
      />
    );

    const safeName = data.student.name.replace(/[^\w\-]+/g, "_");
    const safeYear = yearLabel.replace(/[^\w\-]+/g, "_");
    const filename = `report-card_${safeName}_final-result_${safeYear}.pdf`;

    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (err) {
    console.error("Report card PDF error:", err);
    return NextResponse.json(
      { error: "Failed to generate PDF" },
      { status: 500 }
    );
  }
}
