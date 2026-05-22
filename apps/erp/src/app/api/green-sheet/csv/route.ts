import { NextResponse } from "next/server";
import { createClient } from "@nkps/shared/lib/supabase/server";
import { buildGreenSheetData } from "@/lib/green-sheet";
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
      .eq("feature_key", "green_sheet")
      .maybeSingle();
    if (!perm) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
  }

  const { searchParams } = new URL(request.url);
  const classId = searchParams.get("class_id");
  const academicYearId = searchParams.get("academic_year_id");
  if (!classId || !academicYearId) {
    return NextResponse.json(
      { error: "class_id and academic_year_id are required" },
      { status: 400 }
    );
  }

  const data = await buildGreenSheetData(supabase, classId, academicYearId);
  if (!data) {
    return NextResponse.json(
      { error: "Class or academic year not found" },
      { status: 404 }
    );
  }

  // Header: base + per-exam pair + final columns.
  const header: string[] = ["roll_number", "admission_no", "student_name"];
  for (const e of data.exams) {
    header.push(`${e.exam_name} - obtained`);
    header.push(`${e.exam_name} - %`);
  }
  header.push("final_%", "final_grade", "final_rank", "passed");

  const lines: string[] = [header.map(csvEscape).join(",")];
  for (const r of data.rows) {
    const row: (string | number | null)[] = [
      r.roll_number ?? "",
      r.admission_no,
      r.full_name,
    ];
    for (const e of data.exams) {
      const cell = r.per_exam[e.exam_type_id];
      if (cell && cell.total_max > 0) {
        row.push(`${cell.total_obtained}/${cell.total_max}`);
        row.push(
          cell.percentage === null ? "" : Number(cell.percentage.toFixed(2))
        );
      } else {
        row.push("");
        row.push("");
      }
    }
    row.push(
      r.final ? Number(r.final.overall.main_total_pct.toFixed(2)) : "",
      r.final?.overall.grade ?? "",
      data.meta.show_rank && r.final?.rank ? r.final.rank : "",
      r.final ? (r.final.overall.passed ? "yes" : "no") : ""
    );
    lines.push(row.map(csvEscape).join(","));
  }

  const filename = `green-sheet_${safe(data.meta.class_name)}_${safe(
    data.meta.section ?? ""
  )}_${safe(data.meta.academic_year_label)}.csv`;

  return new NextResponse(lines.join("\n"), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": contentDispositionAttachment(filename),
      "Cache-Control": "no-store",
    },
  });
}
