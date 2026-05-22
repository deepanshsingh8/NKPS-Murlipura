import { NextResponse } from "next/server";
import { renderToBuffer } from "@react-pdf/renderer";
import { promises as fs } from "fs";
import path from "path";
import { verifyAdminOrEditor } from "@nkps/shared/lib/verify-admin";
import { getPdfTemplate } from "@/lib/pdf-templates";
import { contentDispositionAttachment } from "@nkps/shared/lib/utils";
import { safeFetchBuffer } from "@nkps/shared/lib/safe-fetch";
import {
  AdmitCardPDF,
  type AdmitCardPayload,
  type AdmitCardScheduleRow,
  type AdmitCardTemplateConfig,
} from "@/components/pdf/AdmitCardPDF";
import { generateAdmitCardQrBuffer } from "@/lib/admit-card-qr";

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

async function fetchPhoto(url: string | null): Promise<Buffer | null> {
  return safeFetchBuffer(url);
}

export async function GET(request: Request) {
  try {
    const admin = await verifyAdminOrEditor("admit_cards");
    if (!admin) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const classId = searchParams.get("class_id");
    const examTypeId = searchParams.get("exam_type_id");
    const templateId = searchParams.get("template_id");
    const studentIdsParam = searchParams.getAll("student_ids");
    // Support both ?student_ids=a&student_ids=b AND ?student_ids=a,b
    const studentIds =
      studentIdsParam.length > 0
        ? studentIdsParam.flatMap((s) => s.split(",")).filter(Boolean)
        : [];

    if (!classId || !examTypeId) {
      return NextResponse.json(
        { error: "class_id and exam_type_id are required" },
        { status: 400 }
      );
    }

    // Resolve template (explicit or default).
    let templateQuery = admin
      .from("admit_card_templates")
      .select("*")
      .eq("is_active", true);
    templateQuery = templateId
      ? templateQuery.eq("id", templateId)
      : templateQuery.eq("is_default", true);
    const { data: templateRow } = await templateQuery.maybeSingle();
    if (!templateRow) {
      return NextResponse.json(
        {
          error: templateId
            ? "Template not found or inactive"
            : "No default admit card template is active.",
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

    // Exam type.
    const { data: examTypeRow } = await admin
      .from("exam_types")
      .select("id, name, upper_header")
      .eq("id", examTypeId)
      .maybeSingle();
    if (!examTypeRow) {
      return NextResponse.json({ error: "Exam not found" }, { status: 404 });
    }

    // Class (for name + section on each card).
    const { data: classRow } = await admin
      .from("classes")
      .select("id, name, section")
      .eq("id", classId)
      .maybeSingle();
    if (!classRow) {
      return NextResponse.json({ error: "Class not found" }, { status: 404 });
    }

    // Enrollments — either the specific students selected, or the whole active class.
    let enrollQuery = admin
      .from("student_enrollments")
      .select(
        "student_id, roll_number, students(id, full_name, father_name, mother_name, date_of_birth, phone, address, admission_no, photo_url)"
      )
      .eq("class_id", classId)
      .eq("status", "active");
    if (studentIds.length > 0) {
      enrollQuery = enrollQuery.in("student_id", studentIds);
    }
    enrollQuery = enrollQuery.order("roll_number", {
      ascending: true,
      nullsFirst: false,
    });

    const { data: enrollments } = await enrollQuery;
    if (!enrollments || enrollments.length === 0) {
      return NextResponse.json(
        { error: "No students found for the given class/selection" },
        { status: 404 }
      );
    }

    // Safety cap — very large bulks should be batched by the caller.
    const MAX_STUDENTS = 200;
    if (enrollments.length > MAX_STUDENTS) {
      return NextResponse.json(
        {
          error: `Too many students (${enrollments.length}). Split into batches of ≤${MAX_STUDENTS}.`,
        },
        { status: 413 }
      );
    }

    // One schedule fetch per class (not per student — all share the same schedule).
    const { data: scheduleRows } = await admin
      .from("exam_schedules")
      .select(
        "exam_date, start_time, end_time, room, subjects(name, code)"
      )
      .eq("exam_type_id", examTypeId)
      .eq("class_id", classId)
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

    // Fetch PDF template configs + logo once.
    const { header, footer } = await getPdfTemplate(admin, "admit_card");
    const logoData = await loadLogo();

    // Pre-fetch photos in parallel if template wants them — else skip entirely.
    const photoMap = new Map<string, Buffer>();
    if (template.show_photo) {
      const photoEntries = await Promise.all(
        enrollments.map(async (e) => {
          const student = e.students as unknown as {
            id: string;
            photo_url: string | null;
          } | null;
          if (!student?.photo_url) return null;
          const bytes = await fetchPhoto(student.photo_url);
          return bytes ? ([student.id, bytes] as const) : null;
        })
      );
      for (const entry of photoEntries) {
        if (entry) photoMap.set(entry[0], entry[1]);
      }
    }

    // Render one QR per student so exam-hall staff can verify a printed
    // admit card by scanning. M11 — use Promise.allSettled so a single
    // QR generation throw doesn't fail the whole 200-student bundle; the
    // PDF degrades gracefully to "no QR slot" for the affected rows.
    const qrMap = new Map<string, Buffer>();
    const qrResults = await Promise.allSettled(
      enrollments.map(async (e) => {
        const student = e.students as unknown as {
          id: string;
          admission_no: string;
        } | null;
        if (!student) return null;
        const bytes = await generateAdmitCardQrBuffer({
          student_id: student.id,
          admission_no: student.admission_no,
          exam_type_id: examTypeRow.id,
          exam_name: examTypeRow.name,
        });
        return bytes ? ([student.id, bytes] as const) : null;
      })
    );
    for (const r of qrResults) {
      if (r.status === "fulfilled" && r.value) {
        qrMap.set(r.value[0], r.value[1]);
      } else if (r.status === "rejected") {
        console.error("QR gen failed for one student:", r.reason);
      }
    }

    const generatedOn = new Date().toLocaleString("en-IN", {
      timeZone: "Asia/Kolkata",
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });

    const cards: AdmitCardPayload[] = enrollments.map((e) => {
      const student = e.students as unknown as {
        id: string;
        full_name: string;
        father_name: string | null;
        mother_name: string | null;
        date_of_birth: string | null;
        phone: string | null;
        address: string | null;
        admission_no: string;
        photo_url: string | null;
      };
      return {
        student: {
          id: student.id,
          full_name: student.full_name,
          father_name: student.father_name,
          mother_name: student.mother_name,
          date_of_birth: student.date_of_birth,
          phone: student.phone,
          address: student.address,
          admission_no: student.admission_no,
          roll_number: e.roll_number ?? null,
          class_name: classRow.name,
          section: classRow.section,
        },
        exam: {
          name: examTypeRow.name,
          upper_header: examTypeRow.upper_header ?? null,
        },
        schedule,
        studentPhoto: photoMap.get(student.id),
        qrCode: qrMap.get(student.id),
      };
    });

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
        cards={cards}
      />
    );

    const safeClass = `${classRow.name}-${classRow.section}`.replace(
      /[^\w\-]+/g,
      "_"
    );
    const safeExam = examTypeRow.name.replace(/[^\w\-]+/g, "_");
    const filename = `admit-cards_${safeClass}_${safeExam}_${cards.length}students.pdf`;

    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": contentDispositionAttachment(filename),
        "Cache-Control": "private, no-store",
      },
    });
  } catch (err) {
    console.error("Admit card bulk PDF error:", err);
    return NextResponse.json(
      { error: "Failed to generate bulk admit card PDF" },
      { status: 500 }
    );
  }
}
