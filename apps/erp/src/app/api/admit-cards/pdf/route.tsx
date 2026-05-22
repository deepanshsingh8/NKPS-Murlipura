import { NextResponse } from "next/server";
import { renderToBuffer } from "@react-pdf/renderer";
import { promises as fs } from "fs";
import path from "path";
import { createClient } from "@nkps/shared/lib/supabase/server";
import { canViewReportCard } from "@/lib/report-card";
import { getPdfTemplate } from "@/lib/pdf-templates";
import { contentDispositionAttachment } from "@nkps/shared/lib/utils";
import {
  AdmitCardPDF,
  type AdmitCardPayload,
  type AdmitCardScheduleRow,
  type AdmitCardTemplateConfig,
} from "@/components/pdf/AdmitCardPDF";
import { generateAdmitCardQrBuffer } from "@/lib/admit-card-qr";

export const runtime = "nodejs";

// Cache logo bytes across invocations in the same Node process.
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

import { safeFetchBuffer } from "@nkps/shared/lib/safe-fetch";

// Fetch a student photo URL through the SSRF-resistant helper. Returns null
// on any failure — admit card renders without the photo rather than failing
// the whole generation.
async function fetchPhoto(url: string | null): Promise<Buffer | null> {
  return safeFetchBuffer(url);
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
    const templateId = searchParams.get("template_id");

    if (!studentId || !examTypeId) {
      return NextResponse.json(
        { error: "student_id and exam_type_id are required" },
        { status: 400 }
      );
    }

    const allowed = await canViewReportCard(supabase, user.id, studentId);
    if (!allowed) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // Resolve template — either requested ID or current default.
    let templateQuery = supabase
      .from("admit_card_templates")
      .select("*")
      .eq("is_active", true);
    if (templateId) {
      templateQuery = templateQuery.eq("id", templateId);
    } else {
      templateQuery = templateQuery.eq("is_default", true);
    }
    const { data: templateRow } = await templateQuery.maybeSingle();
    if (!templateRow) {
      return NextResponse.json(
        {
          error: templateId
            ? "Template not found or inactive"
            : "No default admit card template is active. Ask an admin to configure one.",
        },
        { status: 404 }
      );
    }

    const template: AdmitCardTemplateConfig = {
      name: templateRow.name,
      orientation: templateRow.orientation,
      show_photo: templateRow.show_photo,
      show_admission_no: templateRow.show_admission_no,
      show_roll_no: templateRow.show_roll_no,
      show_class_section: templateRow.show_class_section,
      show_father_name: templateRow.show_father_name,
      show_mother_name: templateRow.show_mother_name,
      show_dob: templateRow.show_dob,
      show_phone: templateRow.show_phone,
      show_address: templateRow.show_address,
      show_schedule: templateRow.show_schedule,
      show_instructions: templateRow.show_instructions,
      instructions_text: templateRow.instructions_text,
      signature_labels: Array.isArray(templateRow.signature_labels)
        ? (templateRow.signature_labels as string[])
        : ["Principal", "Exam Controller"],
    };

    // Student details + current enrollment (class + roll_number + class name/section).
    const { data: studentRow } = await supabase
      .from("students")
      .select(
        "id, full_name, father_name, mother_name, date_of_birth, phone, address, admission_no, photo_url"
      )
      .eq("id", studentId)
      .maybeSingle();
    if (!studentRow) {
      return NextResponse.json({ error: "Student not found" }, { status: 404 });
    }

    const { data: enrollment } = await supabase
      .from("student_enrollments")
      .select("class_id, roll_number, classes(name, section)")
      .eq("student_id", studentId)
      .eq("status", "active")
      .limit(1)
      .maybeSingle();

    if (!enrollment?.class_id) {
      return NextResponse.json(
        { error: "Student has no active enrollment" },
        { status: 404 }
      );
    }

    const classInfo = enrollment.classes as unknown as {
      name: string;
      section: string;
    } | null;

    // Exam type.
    const { data: examTypeRow } = await supabase
      .from("exam_types")
      .select("id, name, upper_header")
      .eq("id", examTypeId)
      .maybeSingle();
    if (!examTypeRow) {
      return NextResponse.json({ error: "Exam not found" }, { status: 404 });
    }

    // Schedule rows for this class + exam.
    const { data: scheduleRows } = await supabase
      .from("exam_schedules")
      .select(
        "exam_date, start_time, end_time, room, subjects(name, code)"
      )
      .eq("exam_type_id", examTypeId)
      .eq("class_id", enrollment.class_id)
      .order("exam_date", { ascending: true })
      .order("start_time", { ascending: true, nullsFirst: false });

    const schedule: AdmitCardScheduleRow[] = (scheduleRows ?? []).map((r) => {
      const sub = r.subjects as unknown as {
        name: string;
        code: string | null;
      } | null;
      return {
        subject_name: sub?.name ?? "—",
        subject_code: sub?.code ?? null,
        exam_date: r.exam_date as string,
        start_time: (r.start_time as string | null) ?? null,
        end_time: (r.end_time as string | null) ?? null,
        room: (r.room as string | null) ?? null,
      };
    });

    const { header, footer } = await getPdfTemplate(supabase, "admit_card");

    const [logoData, studentPhoto, qrCode] = await Promise.all([
      loadLogo(),
      template.show_photo ? fetchPhoto(studentRow.photo_url) : Promise.resolve(null),
      generateAdmitCardQrBuffer({
        student_id: studentRow.id,
        admission_no: studentRow.admission_no,
        exam_type_id: examTypeRow.id,
        exam_name: examTypeRow.name,
      }),
    ]);

    const generatedOn = new Date().toLocaleString("en-IN", {
      timeZone: "Asia/Kolkata",
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });

    const card: AdmitCardPayload = {
      student: {
        id: studentRow.id,
        full_name: studentRow.full_name,
        father_name: studentRow.father_name,
        mother_name: studentRow.mother_name,
        date_of_birth: studentRow.date_of_birth,
        phone: studentRow.phone,
        address: studentRow.address,
        admission_no: studentRow.admission_no,
        roll_number: enrollment.roll_number ?? null,
        class_name: classInfo?.name ?? "",
        section: classInfo?.section ?? "",
      },
      exam: {
        name: examTypeRow.name,
        upper_header: examTypeRow.upper_header ?? null,
      },
      schedule,
      studentPhoto: studentPhoto ?? undefined,
      qrCode: qrCode ?? undefined,
    };

    const buffer = await renderToBuffer(
      <AdmitCardPDF
        school={{
          name: header.school_name,
          address_line: header.address_line,
          affiliation: header.affiliation,
          affiliation_number: header.affiliation_number,
        }}
        template={template}
        footer={footer}
        logoData={logoData ?? undefined}
        generatedOn={generatedOn}
        cards={[card]}
      />
    );

    const safeName = studentRow.full_name.replace(/[^\w\-]+/g, "_");
    const safeExam = examTypeRow.name.replace(/[^\w\-]+/g, "_");
    const filename = `admit-card_${safeName}_${safeExam}.pdf`;

    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": contentDispositionAttachment(filename),
        "Cache-Control": "private, no-store",
      },
    });
  } catch (err) {
    console.error("Admit card PDF error:", err);
    return NextResponse.json(
      { error: "Failed to generate admit card PDF" },
      { status: 500 }
    );
  }
}
