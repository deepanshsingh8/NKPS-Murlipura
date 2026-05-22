import { NextResponse } from "next/server";
import { createClient } from "@nkps/shared/lib/supabase/server";
import { buildWhiteSheetData } from "@/lib/white-sheet";
import { contentDispositionAttachment } from "@nkps/shared/lib/utils";

function csvEscape(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "";
  const s = String(value);
  if (s.includes(",") || s.includes('"') || s.includes("\n")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function safe(s: string): string {
  return s.replace(/[^\w\-]+/g, "_");
}

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
  if (profile.role !== "admin") {
    const { data: perm } = await supabase
      .from("editor_permissions")
      .select("feature_key")
      .eq("editor_id", user.id)
      .eq("feature_key", "white_sheet")
      .maybeSingle();
    if (!perm) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
  }

  const { searchParams } = new URL(request.url);
  const classId = searchParams.get("class_id");
  const examTypeId = searchParams.get("exam_type_id");

  if (!classId || !examTypeId) {
    return NextResponse.json(
      { error: "class_id and exam_type_id are required" },
      { status: 400 }
    );
  }

  const data = await buildWhiteSheetData(supabase, classId, examTypeId);
  if (!data) {
    return NextResponse.json(
      { error: "Class or exam type not found" },
      { status: 404 }
    );
  }

  const subjectCols = data.subjects.map(
    (s) => `${s.code ?? s.name}${s.role === "optional" ? " (opt)" : ""}`
  );
  const header = [
    "roll_number",
    "admission_no",
    "student_name",
    ...subjectCols,
    "main_obtained",
    "optional_obtained",
    "total_obtained",
    "total_max",
    "percentage",
    "grade",
  ];

  const lines: string[] = [header.map(csvEscape).join(",")];
  for (const r of data.rows) {
    const row = [
      r.roll_number ?? "",
      r.admission_no,
      r.full_name,
      ...data.subjects.map((s) => {
        const m = r.marks_by_subject[s.subject_id];
        return m === null || m === undefined ? "" : m;
      }),
      r.main_obtained,
      r.optional_obtained,
      r.total_obtained,
      r.total_max,
      r.percentage === null ? "" : Number(r.percentage.toFixed(2)),
      r.grade ?? "",
    ];
    lines.push(row.map(csvEscape).join(","));
  }

  const filename = `white-sheet_${safe(data.meta.class_name)}_${safe(
    data.meta.section ?? ""
  )}_${safe(data.meta.exam_name)}.csv`;

  return new NextResponse(lines.join("\n"), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": contentDispositionAttachment(filename),
      "Cache-Control": "no-store",
    },
  });
}
