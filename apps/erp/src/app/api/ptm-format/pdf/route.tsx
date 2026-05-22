import { NextResponse } from "next/server";
import { renderToBuffer } from "@react-pdf/renderer";
import { promises as fs } from "fs";
import path from "path";
import { createClient } from "@nkps/shared/lib/supabase/server";
import { getPdfTemplate } from "@/lib/pdf-templates";
import {
  PtmFormatPDF,
  type PtmFormatPDFProps,
} from "@/components/pdf/PtmFormatPDF";
import { computeGrade, resolveGradeScaleForClass } from "@/lib/grading";
import { contentDispositionAttachment } from "@nkps/shared/lib/utils";

export const runtime = "nodejs";

let cachedLogo: Buffer | null = null;
async function loadLogo(): Promise<Buffer | null> {
  if (cachedLogo) return cachedLogo;
  try {
    const logoPath = path.join(process.cwd(), "public", "images", "logo.png");
    cachedLogo = await fs.readFile(logoPath);
    return cachedLogo;
  } catch {
    return null;
  }
}

// GET /api/ptm-format/pdf?class_id&exam_type_id?&template_id?
// Admin + teacher + editor(ptm_format). Generates one page per student in
// the class. Performance snapshot requires exam_type_id; otherwise that
// section is rendered empty.
export async function GET(request: Request) {
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
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (profile.role !== "admin" && profile.role !== "teacher") {
    const { data: perm } = await supabase
      .from("editor_permissions")
      .select("feature_key")
      .eq("editor_id", user.id)
      .eq("feature_key", "ptm_format")
      .maybeSingle();
    if (!perm) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
  }

  const { searchParams } = new URL(request.url);
  const classId = searchParams.get("class_id");
  const examTypeId = searchParams.get("exam_type_id");
  const templateId = searchParams.get("template_id");

  if (!classId) {
    return NextResponse.json({ error: "class_id is required" }, { status: 400 });
  }

  const { data: cls } = await supabase
    .from("classes")
    .select("id, name, section, academic_year_id")
    .eq("id", classId)
    .maybeSingle();
  if (!cls) {
    return NextResponse.json({ error: "Class not found" }, { status: 404 });
  }

  // Resolve template — specific id if provided, else is_default=true, else
  // the first active row. Missing entirely → the seeded "Default PTM Format"
  // from the migration should be present but we bail gracefully.
  let templateQuery = supabase
    .from("ptm_formats")
    .select("*")
    .eq("is_active", true);
  if (templateId) templateQuery = templateQuery.eq("id", templateId);
  else templateQuery = templateQuery.order("is_default", { ascending: false });
  const { data: tmplRow } = await templateQuery.limit(1).maybeSingle();
  if (!tmplRow) {
    return NextResponse.json(
      {
        error: templateId
          ? "Template not found or inactive"
          : "No active PTM format template configured",
      },
      { status: 404 }
    );
  }

  const signatureLabels = Array.isArray(tmplRow.signature_labels)
    ? (tmplRow.signature_labels as unknown[]).filter(
        (x): x is string => typeof x === "string"
      )
    : ["Class Teacher", "Parent Signature"];

  const template: PtmFormatPDFProps["template"] = {
    name: tmplRow.name as string,
    intro_text: (tmplRow.intro_text as string | null) ?? null,
    closing_text: (tmplRow.closing_text as string | null) ?? null,
    show_student_details: Boolean(tmplRow.show_student_details),
    show_photo: Boolean(tmplRow.show_photo),
    show_father_name: Boolean(tmplRow.show_father_name),
    show_mother_name: Boolean(tmplRow.show_mother_name),
    show_performance_snapshot: Boolean(tmplRow.show_performance_snapshot),
    show_teacher_remarks_section: Boolean(tmplRow.show_teacher_remarks_section),
    teacher_remarks_lines: (tmplRow.teacher_remarks_lines as number) ?? 6,
    show_parent_signature: Boolean(tmplRow.show_parent_signature),
    signature_labels:
      signatureLabels.length > 0
        ? signatureLabels
        : ["Class Teacher", "Parent Signature"],
  };

  const { data: enrollments } = await supabase
    .from("student_enrollments")
    .select(
      "student_id, roll_number, students(id, full_name, admission_no, father_name, mother_name, photo_url)"
    )
    .eq("class_id", classId)
    .eq("status", "active")
    .order("roll_number", { ascending: true, nullsFirst: false });

  type RawStudent = {
    id: string;
    full_name: string;
    admission_no: string;
    father_name: string | null;
    mother_name: string | null;
    photo_url: string | null;
  };

  const studentRows = (enrollments ?? [])
    .map((e) => {
      const s = e.students as unknown as RawStudent | null;
      if (!s) return null;
      return {
        student_id: s.id,
        roll_number: (e.roll_number as number | null) ?? null,
        admission_no: s.admission_no ?? "",
        full_name: s.full_name ?? "",
        father_name: s.father_name ?? null,
        mother_name: s.mother_name ?? null,
        photo_url: s.photo_url ?? null,
      };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);

  // Performance snapshot — only computed when an exam is specified. We
  // resolve the class grade scale once (not per student) and batch-fetch
  // results for the full enrolled set.
  let performanceByStudent = new Map<
    string,
    PtmFormatPDFProps["students"][number]["performance"]
  >();
  let examName: string | null = null;

  if (examTypeId && studentRows.length > 0) {
    const { data: exam } = await supabase
      .from("exam_types")
      .select("name")
      .eq("id", examTypeId)
      .maybeSingle();
    examName = (exam?.name as string | null) ?? null;

    const scale = await resolveGradeScaleForClass(
      supabase,
      classId,
      "scholastic"
    );
    const bands = scale?.bands ?? [];

    const studentIds = studentRows.map((s) => s.student_id);
    const { data: results } = await supabase
      .from("results")
      .select(
        "student_id, marks_obtained, max_marks, subjects(id, name)"
      )
      .eq("class_id", classId)
      .eq("exam_type_id", examTypeId)
      .in("student_id", studentIds);

    const byStudent = new Map<
      string,
      Array<{ name: string; obtained: number; max: number }>
    >();
    for (const r of results ?? []) {
      const sub = r.subjects as unknown as { id: string; name: string } | null;
      if (!sub) continue;
      const arr = byStudent.get(r.student_id as string) ?? [];
      arr.push({
        name: sub.name,
        obtained: Number(r.marks_obtained),
        max: Number(r.max_marks),
      });
      byStudent.set(r.student_id as string, arr);
    }

    performanceByStudent = new Map(
      studentRows.map((s) => {
        const rows = byStudent.get(s.student_id) ?? [];
        rows.sort((a, b) => a.name.localeCompare(b.name));
        const totalObt = rows.reduce((sum, r) => sum + r.obtained, 0);
        const totalMax = rows.reduce((sum, r) => sum + r.max, 0);
        const pct = totalMax > 0 ? (totalObt / totalMax) * 100 : null;
        const grade =
          pct !== null && bands.length > 0 ? computeGrade(pct, bands) : null;
        return [
          s.student_id,
          {
            exam_name: examName,
            subjects: rows.map((r) => ({
              subject_name: r.name,
              marks_obtained: r.obtained,
              max_marks: r.max,
              grade:
                r.max > 0 && bands.length > 0
                  ? computeGrade((r.obtained / r.max) * 100, bands)
                  : null,
            })),
            total_obtained: totalObt,
            total_max: totalMax,
            percentage: pct,
            grade,
          },
        ];
      })
    );
  }

  const { header } = await getPdfTemplate(supabase, "ptm_format");
  const logoData = await loadLogo();
  const generatedOn = new Date().toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

  const payload: PtmFormatPDFProps["students"] = studentRows.map((s) => ({
    student: {
      full_name: s.full_name,
      admission_no: s.admission_no,
      roll_number: s.roll_number,
      class_label: cls.name as string,
      section: (cls.section as string | null) ?? null,
      father_name: s.father_name,
      mother_name: s.mother_name,
    },
    performance: performanceByStudent.get(s.student_id) ?? null,
  }));

  const buffer = await renderToBuffer(
    <PtmFormatPDF
      school={{
        name: header.school_name,
        address_line: header.address_line,
        affiliation: header.affiliation,
        affiliation_number: header.affiliation_number,
      }}
      template={template}
      students={payload}
      logoData={logoData ?? undefined}
      generatedOn={generatedOn}
    />
  );

  const safe = (s: string) => s.replace(/[^\w\-]+/g, "_");
  const filename = `ptm-format_${safe(cls.name as string)}_${safe(
    (cls.section as string | null) ?? ""
  )}.pdf`;

  return new NextResponse(new Uint8Array(buffer), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": contentDispositionAttachment(filename),
      "Cache-Control": "private, no-store",
    },
  });
}
