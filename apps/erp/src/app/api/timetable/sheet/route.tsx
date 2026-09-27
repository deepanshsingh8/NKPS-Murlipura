import { NextRequest, NextResponse } from "next/server";
import { renderToBuffer } from "@react-pdf/renderer";
import { verifyAdminOrEditor } from "@nkps/shared/lib/verify-admin";
import { SCHOOL } from "@nkps/shared/lib/constants";
import { TimetableGridPDF } from "@/components/pdf/TimetableGridPDF";
import { fetchTimetableSheet } from "@/lib/timetable-sheet";

/**
 * A week's timetable as a printable PDF, for a class or for a teacher.
 *
 *   GET /api/timetable/sheet?class_id=…
 *   GET /api/timetable/sheet?teacher_id=…
 *
 * There was no printable timetable anywhere in the ERP before this, which is
 * a gap that long predates parallel groups — but groups are what made it
 * urgent, since a Games period now carries three coaches that only the screen
 * could show.
 */

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const admin = await verifyAdminOrEditor("timetable");
  if (!admin) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const classId = searchParams.get("class_id");
  const teacherId = searchParams.get("teacher_id");

  if ((classId && teacherId) || (!classId && !teacherId)) {
    return NextResponse.json(
      { error: "Pass exactly one of class_id or teacher_id" },
      { status: 400 }
    );
  }

  const mode = classId ? ("class" as const) : ("teacher" as const);
  const id = (classId ?? teacherId) as string;

  // Who the sheet is for, and a filename that means something in a downloads
  // folder six months later.
  let subtitle = "";
  let slug = "timetable";
  if (mode === "class") {
    const { data: cls } = await admin
      .from("classes")
      .select("name, section")
      .eq("id", id)
      .maybeSingle();
    if (!cls) {
      return NextResponse.json({ error: "Class not found" }, { status: 404 });
    }
    subtitle = `${cls.name}${cls.section ? `-${cls.section}` : ""}`;
    slug = subtitle;
  } else {
    const { data: teacher } = await admin
      .from("teachers")
      .select("full_name")
      .eq("id", id)
      .maybeSingle();
    if (!teacher) {
      return NextResponse.json({ error: "Teacher not found" }, { status: 404 });
    }
    subtitle = teacher.full_name;
    slug = teacher.full_name;
  }

  const { data: year } = await admin
    .from("academic_years")
    .select("name")
    .eq("is_current", true)
    .maybeSingle();

  let sheet;
  try {
    sheet = await fetchTimetableSheet(admin, mode, id);
  } catch (e) {
    console.error("[timetable/sheet] load:", e);
    return NextResponse.json(
      { error: "Failed to load the timetable" },
      { status: 500 }
    );
  }

  const generatedOn = new Date().toLocaleString("en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
  });

  const buffer = await renderToBuffer(
    <TimetableGridPDF
      school={{ name: SCHOOL.name, address_line: SCHOOL.address.full }}
      title={mode === "class" ? "Class Timetable" : "Teacher Timetable"}
      subtitle={subtitle}
      caption={year?.name ?? null}
      periods={sheet.periods}
      cells={sheet.cells}
      generated_on={generatedOn}
    />
  );

  const safeSlug = slug.replace(/[^\w\-]+/g, "_");
  return new NextResponse(buffer as unknown as BodyInit, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="timetable-${safeSlug}.pdf"`,
    },
  });
}
