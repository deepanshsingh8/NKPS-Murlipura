import { NextResponse } from "next/server";
import { renderToBuffer } from "@react-pdf/renderer";
import { promises as fs } from "fs";
import path from "path";
import { createClient } from "@nkps/shared/lib/supabase/server";
import { getPdfTemplate } from "@/lib/pdf-templates";
import { BlankMarksListPDF } from "@/components/pdf/BlankMarksListPDF";
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

export async function GET(request: Request) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Admin or editor-with-blank_marks_list gate. Browser-initiated GET uses
    // cookie auth (same pattern as report-card PDF), so inline the check
    // instead of going through verifyAdminOrEditor (Bearer-only).
    const { data: profile } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .single();
    if (!profile) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    if (profile.role !== "admin") {
      const { data: perm } = await supabase
        .from("editor_permissions")
        .select("feature_key")
        .eq("editor_id", user.id)
        .eq("feature_key", "blank_marks_list")
        .maybeSingle();
      if (!perm) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
    }

    const { searchParams } = new URL(request.url);
    const classId = searchParams.get("class_id");
    const examTypeId = searchParams.get("exam_type_id");
    const subjectId = searchParams.get("subject_id");

    if (!classId || !examTypeId || !subjectId) {
      return NextResponse.json(
        { error: "class_id, exam_type_id, and subject_id are required" },
        { status: 400 }
      );
    }

    const [{ data: cls }, { data: exam }, { data: subject }] =
      await Promise.all([
        supabase
          .from("classes")
          .select("name, section")
          .eq("id", classId)
          .maybeSingle(),
        supabase
          .from("exam_types")
          .select("name, max_marks")
          .eq("id", examTypeId)
          .maybeSingle(),
        supabase
          .from("subjects")
          .select("name, code")
          .eq("id", subjectId)
          .maybeSingle(),
      ]);

    if (!cls || !exam || !subject) {
      return NextResponse.json(
        { error: "Class, exam type, or subject not found" },
        { status: 404 }
      );
    }

    // Max marks: prefer class_exam_configs override for this class if set,
    // else exam_types.max_marks. Mirrors marks-entry behavior so the blank
    // list matches what teachers will actually enter against.
    const { data: classConfig } = await supabase
      .from("class_exam_configs")
      .select("max_marks_override")
      .eq("exam_type_id", examTypeId)
      .eq("class_id", classId)
      .maybeSingle();
    const effectiveMaxMarks =
      (classConfig?.max_marks_override as number | null) ??
      (exam.max_marks as number);

    // Exam schedule row for date/room (optional — blank if not scheduled).
    const { data: scheduleRow } = await supabase
      .from("exam_schedules")
      .select("exam_date, room")
      .eq("exam_type_id", examTypeId)
      .eq("class_id", classId)
      .eq("subject_id", subjectId)
      .maybeSingle();

    const { data: enrollments } = await supabase
      .from("student_enrollments")
      .select("student_id, roll_number, students(full_name, admission_no)")
      .eq("class_id", classId)
      .eq("status", "active")
      .order("roll_number", { ascending: true, nullsFirst: false });

    const students = (enrollments ?? []).map((e) => {
      const s = e.students as unknown as {
        full_name: string;
        admission_no: string;
      } | null;
      return {
        roll_number: (e.roll_number as number | null) ?? null,
        admission_no: s?.admission_no ?? "",
        full_name: s?.full_name ?? "",
      };
    });

    const { header } = await getPdfTemplate(supabase, "blank_marks_list");
    const logoData = await loadLogo();

    const generatedOn = new Date().toLocaleString("en-IN", {
      timeZone: "Asia/Kolkata",
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });

    const buffer = await renderToBuffer(
      <BlankMarksListPDF
        school={{
          name: header.school_name,
          address_line: header.address_line,
          affiliation: header.affiliation,
          affiliation_number: header.affiliation_number,
        }}
        meta={{
          class_label: cls.name ?? "",
          section: (cls.section as string | null) ?? null,
          exam_name: exam.name ?? "",
          subject_name: subject.name ?? "",
          subject_code: (subject.code as string | null) ?? null,
          max_marks: effectiveMaxMarks,
          exam_date: (scheduleRow?.exam_date as string | null) ?? null,
          room: (scheduleRow?.room as string | null) ?? null,
        }}
        students={students}
        logoData={logoData ?? undefined}
        generatedOn={generatedOn}
      />
    );

    const safe = (s: string) => s.replace(/[^\w\-]+/g, "_");
    const filename = `blank-marks_${safe(cls.name ?? "")}_${safe(cls.section ?? "")}_${safe(subject.code ?? subject.name ?? "")}_${safe(exam.name ?? "")}.pdf`;

    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": contentDispositionAttachment(filename),
        "Cache-Control": "private, no-store",
      },
    });
  } catch (err) {
    console.error("Blank marks list PDF error:", err);
    return NextResponse.json(
      { error: "Failed to generate PDF" },
      { status: 500 }
    );
  }
}
