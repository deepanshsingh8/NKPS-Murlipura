import { NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { verifyAdminOrEditor } from "@nkps/shared/lib/verify-admin";
import { contentDispositionAttachment } from "@nkps/shared/lib/utils";
import {
  STUDENT_TEMPLATE_FIELDS,
  type StudentTemplateField,
  formatFieldValue,
  indianNationalFromNationality,
} from "@nkps/shared/lib/student-template";

export const runtime = "nodejs";

/**
 * GET /api/students/[id]/export
 *
 * Downloads one student's full record as an .xlsx laid out like the school's
 * mandated template: a "General Profile" section (21 particulars) followed by
 * an "Enrolment Profile" section (12 particulars), with S.No. cells merged
 * across multi-row particulars (Mother/Father/Guardian, addresses, previous
 * school block, …). The row set and ordering come from the shared field
 * registry, so the export can never drift from the bulk-upload template.
 */
export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const admin = await verifyAdminOrEditor("students");
    if (!admin) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await context.params;

    const { data: student, error: studentError } = await admin
      .from("students")
      .select("*")
      .eq("id", id)
      .single();

    if (studentError || !student) {
      return NextResponse.json({ error: "Student not found" }, { status: 404 });
    }

    // Representative enrollment — same priority as the students listing:
    // current-year row, then active status, then most recently updated.
    const { data: currentYear } = await admin
      .from("academic_years")
      .select("id")
      .eq("is_current", true)
      .maybeSingle();
    const currentYearId = currentYear?.id ?? null;

    const { data: enrollments } = await admin
      .from("student_enrollments")
      .select(
        "class_id, academic_year_id, status, roll_number, updated_at, classes(name, section), streams:stream_id(name)"
      )
      .eq("student_id", id);

    type EnrollmentRow = NonNullable<typeof enrollments>[number];
    const enrollment = (enrollments ?? [])
      .slice()
      .sort((a: EnrollmentRow, b: EnrollmentRow) => {
        const aYear = currentYearId && a.academic_year_id === currentYearId ? 0 : 1;
        const bYear = currentYearId && b.academic_year_id === currentYearId ? 0 : 1;
        if (aYear !== bYear) return aYear - bYear;
        const aStatus = a.status === "active" ? 0 : 1;
        const bStatus = b.status === "active" ? 0 : 1;
        if (aStatus !== bStatus) return aStatus - bStatus;
        return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime();
      })[0];

    const unwrap = <T,>(rel: T | T[] | null | undefined): T | null =>
      Array.isArray(rel) ? (rel[0] ?? null) : (rel ?? null);
    const cls = unwrap(enrollment?.classes as { name: string; section: string } | { name: string; section: string }[] | null);
    const stream = unwrap(enrollment?.streams as { name: string } | { name: string }[] | null);

    // Subjects: the student's own subject links for their class; if none are
    // recorded, fall back to everything taught in the class.
    let subjectNames: string[] = [];
    if (enrollment?.class_id) {
      const { data: ss } = await admin
        .from("student_subjects")
        .select("class_subjects(class_id, subjects:subject_id(name))")
        .eq("student_id", id);
      for (const row of ss ?? []) {
        const csRel = unwrap(
          row.class_subjects as
            | { class_id: string; subjects: { name: string } | { name: string }[] | null }
            | { class_id: string; subjects: { name: string } | { name: string }[] | null }[]
            | null
        );
        if (!csRel || csRel.class_id !== enrollment.class_id) continue;
        const subject = unwrap(csRel.subjects);
        if (subject?.name) subjectNames.push(subject.name);
      }
      if (subjectNames.length === 0) {
        const { data: cs } = await admin
          .from("class_subjects")
          .select("subjects:subject_id(name)")
          .eq("class_id", enrollment.class_id);
        subjectNames = (cs ?? [])
          .map((row) => unwrap(row.subjects as { name: string } | { name: string }[] | null)?.name)
          .filter((n): n is string => Boolean(n));
      }
    }

    const record = student as Record<string, unknown>;

    const valueFor = (field: StudentTemplateField): string => {
      switch (field.key) {
        case "class_name":
          return cls?.name ?? "";
        case "section":
          return cls?.section ?? "";
        case "stream":
          return stream?.name ?? "";
        case "subjects":
          return subjectNames.join(", ");
        case "indian_national":
          return formatFieldValue(field, indianNationalFromNationality(student.nationality));
        default:
          return formatFieldValue(field, record[field.key]);
      }
    };

    // ── Build the sheet: stacked General + Enrolment sections, 3 columns
    // (S.No. | Particulars | Details), S.No. merged across grouped rows. ──
    const aoa: (string | number)[][] = [];
    const merges: XLSX.Range[] = [];

    const addTitleRow = (text: string) => {
      merges.push({ s: { r: aoa.length, c: 0 }, e: { r: aoa.length, c: 2 } });
      aoa.push([text, "", ""]);
    };

    const addSection = (section: "general" | "enrolment", title: string) => {
      addTitleRow(title);
      aoa.push(["S.No.", "Particulars", "Details"]);

      const fields = STUDENT_TEMPLATE_FIELDS.filter(
        (f) => f.section === section && !f.extra
      ).sort((a, b) => a.particular - b.particular);

      let i = 0;
      while (i < fields.length) {
        const particular = fields[i].particular;
        const group = fields.filter((f) => f.particular === particular);
        const startRow = aoa.length;
        for (let g = 0; g < group.length; g++) {
          const f = group[g];
          aoa.push([g === 0 ? particular : "", f.exportLabel ?? f.label, valueFor(f)]);
        }
        if (group.length > 1) {
          merges.push({
            s: { r: startRow, c: 0 },
            e: { r: startRow + group.length - 1, c: 0 },
          });
        }
        i += group.length;
      }
    };

    addTitleRow(`STUDENT PROFILE — ${student.full_name} (${student.admission_no})`);
    aoa.push(["", "", ""]);
    addSection("general", "GENERAL PROFILE");
    aoa.push(["", "", ""]);
    addSection("enrolment", "ENROLMENT PROFILE");

    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws["!merges"] = merges;
    ws["!cols"] = [{ wch: 6 }, { wch: 52 }, { wch: 42 }];

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Student Profile");
    const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;

    return new NextResponse(new Uint8Array(buf), {
      status: 200,
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": contentDispositionAttachment(
          `student-profile-${student.admission_no}.xlsx`
        ),
      },
    });
  } catch (err) {
    console.error("[students.export.GET]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
