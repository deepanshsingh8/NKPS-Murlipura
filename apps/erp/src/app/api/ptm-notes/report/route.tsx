import { NextResponse } from "next/server";
import { renderToBuffer } from "@react-pdf/renderer";
import { promises as fs } from "fs";
import path from "path";
import { createClient } from "@nkps/shared/lib/supabase/server";
import { getPdfTemplate } from "@/lib/pdf-templates";
import { contentDispositionAttachment } from "@nkps/shared/lib/utils";
import {
  PtmNotesReportPDF,
  type PtmReportStudentBlock,
} from "@/components/pdf/PtmNotesReportPDF";

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

// GET /api/ptm-notes/report?class_id&exam_type_id
// Admin + teacher + editor(ptm_notes). Parents don't get a whole-class PDF.
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
      .eq("feature_key", "ptm_notes")
      .maybeSingle();
    if (!perm) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
  }

  const { searchParams } = new URL(request.url);
  const classId = searchParams.get("class_id");
  const examTypeId = searchParams.get("exam_type_id");
  if (!classId) {
    return NextResponse.json(
      { error: "class_id is required" },
      { status: 400 }
    );
  }

  const { data: cls } = await supabase
    .from("classes")
    .select("id, name, section, academic_year_id")
    .eq("id", classId)
    .maybeSingle();
  if (!cls) {
    return NextResponse.json({ error: "Class not found" }, { status: 404 });
  }

  let examName: string | null = null;
  if (examTypeId) {
    const { data: exam } = await supabase
      .from("exam_types")
      .select("name")
      .eq("id", examTypeId)
      .maybeSingle();
    examName = (exam?.name as string | undefined) ?? null;
  }

  const { data: enrollments } = await supabase
    .from("student_enrollments")
    .select("student_id, roll_number, students(full_name, admission_no)")
    .eq("class_id", classId)
    .eq("status", "active")
    .order("roll_number", { ascending: true, nullsFirst: false });

  const studentRows = (enrollments ?? []).map((e) => {
    const s = e.students as unknown as {
      full_name: string;
      admission_no: string;
    } | null;
    return {
      student_id: e.student_id as string,
      roll_number: (e.roll_number as number | null) ?? null,
      admission_no: s?.admission_no ?? "",
      full_name: s?.full_name ?? "",
    };
  });

  const studentIds = studentRows.map((s) => s.student_id);
  let notesByStudent = new Map<
    string,
    PtmReportStudentBlock["notes"]
  >();

  if (studentIds.length > 0) {
    let noteQuery = supabase
      .from("ptm_notes")
      .select(
        "student_id, meeting_date, attendance, teacher_remarks, parent_remarks, action_points"
      )
      .in("student_id", studentIds)
      .order("meeting_date", { ascending: false });
    if (examTypeId) noteQuery = noteQuery.eq("exam_type_id", examTypeId);

    const { data: notes } = await noteQuery;
    notesByStudent = new Map();
    for (const n of notes ?? []) {
      const sid = n.student_id as string;
      const arr = notesByStudent.get(sid) ?? [];
      arr.push({
        meeting_date: n.meeting_date as string,
        attendance: n.attendance as "present" | "absent",
        teacher_remarks: (n.teacher_remarks as string | null) ?? null,
        parent_remarks: (n.parent_remarks as string | null) ?? null,
        action_points: (n.action_points as string | null) ?? null,
      });
      notesByStudent.set(sid, arr);
    }
  }

  // Total school meetings — prefer the most specific scope available:
  // (year, exam, class) > (year, NULL, class) > (year, exam, NULL) > (year, NULL, NULL).
  const { data: counterRows } = await supabase
    .from("school_meeting_counts")
    .select("exam_type_id, class_id, total_meetings")
    .eq("academic_year_id", cls.academic_year_id);

  const countByKey = new Map<string, number>();
  for (const row of counterRows ?? []) {
    const k = `${row.exam_type_id ?? "null"}|${row.class_id ?? "null"}`;
    countByKey.set(k, row.total_meetings as number);
  }
  const preferKeys = [
    `${examTypeId ?? "null"}|${classId}`,
    `null|${classId}`,
    `${examTypeId ?? "null"}|null`,
    `null|null`,
  ];
  let totalSchoolMeetings: number | null = null;
  for (const k of preferKeys) {
    if (countByKey.has(k)) {
      totalSchoolMeetings = countByKey.get(k)!;
      break;
    }
  }

  const students: PtmReportStudentBlock[] = studentRows.map((s) => ({
    roll_number: s.roll_number,
    admission_no: s.admission_no,
    full_name: s.full_name,
    notes: notesByStudent.get(s.student_id) ?? [],
  }));

  const { header } = await getPdfTemplate(supabase, "report_card");
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
    <PtmNotesReportPDF
      school={{
        name: header.school_name,
        address_line: header.address_line,
        affiliation: header.affiliation,
        affiliation_number: header.affiliation_number,
      }}
      meta={{
        class_label: cls.name as string,
        section: (cls.section as string | null) ?? null,
        exam_name: examName,
        total_school_meetings: totalSchoolMeetings,
      }}
      students={students}
      logoData={logoData ?? undefined}
      generatedOn={generatedOn}
    />
  );

  const safe = (s: string) => s.replace(/[^\w\-]+/g, "_");
  const filename = `ptm-notes_${safe(cls.name as string)}_${safe(
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
