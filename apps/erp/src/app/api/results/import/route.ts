import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@nkps/shared/lib/supabase/server";
import { computeGrade, resolveGradeScaleForClass } from "@/lib/grading";
import * as XLSX from "xlsx";

interface ParsedRow {
  admission_no?: string;
  roll_number?: string | number;
  student_name?: string;
  marks_obtained?: string | number;
}

interface RowResult {
  index: number;
  admission_no: string;
  roll_number: string | number | "";
  student_name: string;
  marks_obtained: number | null;
  ok: boolean;
  error?: string;
  matched_student_id?: string;
}

function normalizeKey(key: string): string {
  return key
    .trim()
    .toLowerCase()
    .replace(/[\s\-]+/g, "_")
    .replace(/[^a-z0-9_]/g, "");
}

// POST /api/results/import — multipart/form-data upload.
// Fields: file, class_id, exam_type_id, subject_id, dry_run ("true" | "false")
// Returns: { summary, rows }. Commits only when dry_run=false AND all rows are valid.
export async function POST(request: NextRequest) {
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
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (profile.role !== "admin" && profile.role !== "teacher") {
    const { data: perm } = await supabase
      .from("editor_permissions")
      .select("feature_key")
      .eq("editor_id", user.id)
      .eq("feature_key", "results")
      .maybeSingle();
    if (!perm) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: "Expected multipart/form-data" }, { status: 400 });
  }

  const file = form.get("file");
  const classId = String(form.get("class_id") ?? "");
  const examTypeId = String(form.get("exam_type_id") ?? "");
  const subjectId = String(form.get("subject_id") ?? "");
  const dryRun = String(form.get("dry_run") ?? "true") !== "false";

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Missing file" }, { status: 400 });
  }
  // L1 — cap upload size before reading into memory. The XLSX parser used
  // below needs the full buffer; a 50 MB file would OOM the function.
  // 5 MB covers a 10k-student sheet comfortably.
  const MAX_BYTES = 5 * 1024 * 1024;
  if (file.size > MAX_BYTES) {
    return NextResponse.json(
      { error: `File too large. Maximum upload size is ${MAX_BYTES / 1024 / 1024} MB.` },
      { status: 413 }
    );
  }
  if (!classId || !examTypeId || !subjectId) {
    return NextResponse.json(
      { error: "class_id, exam_type_id, and subject_id are required" },
      { status: 400 }
    );
  }

  const { data: examType } = await supabase
    .from("exam_types")
    .select("max_marks")
    .eq("id", examTypeId)
    .maybeSingle();
  if (!examType) {
    return NextResponse.json({ error: "Exam type not found" }, { status: 404 });
  }
  const maxMarks = examType.max_marks as number;

  const { data: enrollments } = await supabase
    .from("student_enrollments")
    .select("student_id, roll_number, students(full_name, admission_no)")
    .eq("class_id", classId)
    .eq("status", "active");

  const byAdmission = new Map<string, { student_id: string; full_name: string }>();
  const byRoll = new Map<string, { student_id: string; full_name: string }>();
  for (const e of enrollments ?? []) {
    const s = e.students as unknown as { full_name: string; admission_no: string };
    const studentId = e.student_id as string;
    if (s?.admission_no) {
      byAdmission.set(String(s.admission_no).trim(), {
        student_id: studentId,
        full_name: s.full_name ?? "",
      });
    }
    const roll = e.roll_number as number | null;
    if (roll !== null && roll !== undefined) {
      byRoll.set(String(roll), {
        student_id: studentId,
        full_name: s?.full_name ?? "",
      });
    }
  }

  // Parse the CSV/XLSX via SheetJS — handles quoted commas correctly.
  const buf = await file.arrayBuffer();
  let workbook: XLSX.WorkBook;
  try {
    workbook = XLSX.read(new Uint8Array(buf), { type: "array" });
  } catch (err) {
    console.error("XLSX parse error:", err);
    return NextResponse.json({ error: "Could not parse file" }, { status: 400 });
  }
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) {
    return NextResponse.json({ error: "File has no sheets" }, { status: 400 });
  }
  const sheet = workbook.Sheets[sheetName];

  // Use defval:"" so empty cells are empty strings rather than undefined.
  const rawRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
    defval: "",
    raw: true,
  });

  // Normalize headers: build a per-row object with canonical keys.
  const normalized: ParsedRow[] = rawRows.map((r) => {
    const out: ParsedRow = {};
    for (const k of Object.keys(r)) {
      const nk = normalizeKey(k);
      switch (nk) {
        case "admission_no":
        case "admissionno":
        case "admission":
          out.admission_no = String(r[k] ?? "").trim();
          break;
        case "roll_number":
        case "rollno":
        case "roll":
          out.roll_number = r[k] as string | number;
          break;
        case "student_name":
        case "name":
          out.student_name = String(r[k] ?? "").trim();
          break;
        case "marks_obtained":
        case "marks":
          out.marks_obtained = r[k] as string | number;
          break;
        default:
          break;
      }
    }
    return out;
  });

  // Per-row validation.
  const seenAdmissions = new Set<string>();
  const results: RowResult[] = normalized.map((row, i) => {
    const admission = (row.admission_no ?? "").trim();
    const rollRaw = row.roll_number ?? "";
    const roll = rollRaw === "" ? "" : String(rollRaw).trim();
    const name = row.student_name ?? "";
    const marksRaw = row.marks_obtained;
    const marksStr = marksRaw === "" || marksRaw === undefined ? "" : String(marksRaw).trim();

    // Blank-marks rows are valid-but-skipped.
    if (marksStr === "") {
      return {
        index: i + 2,
        admission_no: admission,
        roll_number: roll,
        student_name: name,
        marks_obtained: null,
        ok: true,
      };
    }

    const marksNum = Number(marksStr);
    if (!Number.isFinite(marksNum)) {
      return {
        index: i + 2,
        admission_no: admission,
        roll_number: roll,
        student_name: name,
        marks_obtained: null,
        ok: false,
        error: `Marks "${marksStr}" is not a number`,
      };
    }
    if (marksNum < 0 || marksNum > maxMarks) {
      return {
        index: i + 2,
        admission_no: admission,
        roll_number: roll,
        student_name: name,
        marks_obtained: marksNum,
        ok: false,
        error: `Marks must be between 0 and ${maxMarks}`,
      };
    }

    // Match by admission_no first, then fall back to roll_number.
    let match = admission ? byAdmission.get(admission) : undefined;
    if (!match && roll) match = byRoll.get(roll);

    if (!match) {
      return {
        index: i + 2,
        admission_no: admission,
        roll_number: roll,
        student_name: name,
        marks_obtained: marksNum,
        ok: false,
        error: admission
          ? `No enrolled student with admission "${admission}"`
          : roll
            ? `No enrolled student with roll ${roll}`
            : "Provide admission_no or roll_number",
      };
    }

    if (admission && seenAdmissions.has(admission)) {
      return {
        index: i + 2,
        admission_no: admission,
        roll_number: roll,
        student_name: name,
        marks_obtained: marksNum,
        ok: false,
        error: "Duplicate admission number in this upload",
      };
    }
    if (admission) seenAdmissions.add(admission);

    return {
      index: i + 2,
      admission_no: admission,
      roll_number: roll,
      student_name: name,
      marks_obtained: marksNum,
      ok: true,
      matched_student_id: match.student_id,
    };
  });

  const errorCount = results.filter((r) => !r.ok).length;
  const appliedRows = results.filter(
    (r) => r.ok && r.marks_obtained !== null && r.matched_student_id
  );

  if (dryRun || errorCount > 0 || appliedRows.length === 0) {
    return NextResponse.json({
      summary: {
        total: results.length,
        to_apply: appliedRows.length,
        errors: errorCount,
        committed: 0,
        dry_run: dryRun || errorCount > 0,
      },
      rows: results,
    });
  }

  // Commit path — resolve grades and upsert.
  const scale = await resolveGradeScaleForClass(supabase, classId);
  const bands = scale?.bands ?? [];

  const records = appliedRows.map((r) => ({
    student_id: r.matched_student_id!,
    class_id: classId,
    subject_id: subjectId,
    exam_type_id: examTypeId,
    marks_obtained: r.marks_obtained!,
    max_marks: maxMarks,
    grade: computeGrade((r.marks_obtained! / maxMarks) * 100, bands),
    entered_by: user.id,
  }));

  const { error: upsertErr } = await supabase
    .from("results")
    .upsert(records, { onConflict: "student_id,subject_id,exam_type_id" });
  if (upsertErr) {
    console.error("Marks import upsert error:", upsertErr);
    return NextResponse.json({ error: "Failed to save marks" }, { status: 500 });
  }

  return NextResponse.json({
    summary: {
      total: results.length,
      to_apply: appliedRows.length,
      errors: 0,
      committed: records.length,
      dry_run: false,
    },
    rows: results,
  });
}
