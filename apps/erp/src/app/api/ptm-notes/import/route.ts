import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@nkps/shared/lib/supabase/server";
import * as XLSX from "xlsx";

interface ParsedRow {
  admission_no?: string;
  roll_number?: string | number;
  student_name?: string;
  meeting_date?: string | number;
  attendance?: string;
  teacher_remarks?: string;
  parent_remarks?: string;
  action_points?: string;
}

interface RowResult {
  index: number;
  admission_no: string;
  roll_number: string | number | "";
  student_name: string;
  meeting_date: string;
  attendance: string;
  ok: boolean;
  error?: string;
  matched_student_id?: string;
  // Carried for the commit path so we don't need to re-thread the source
  // row array.
  teacher_remarks?: string | null;
  parent_remarks?: string | null;
  action_points?: string | null;
}

function normalizeKey(key: string): string {
  return key
    .trim()
    .toLowerCase()
    .replace(/[\s\-]+/g, "_")
    .replace(/[^a-z0-9_]/g, "");
}

function parseDateValue(raw: unknown): string | null {
  if (raw === null || raw === undefined || raw === "") return null;
  // SheetJS with raw:true can produce a Date object for date cells.
  if (raw instanceof Date) {
    const iso = raw.toISOString();
    return iso.slice(0, 10);
  }
  const s = String(raw).trim();
  // Already YYYY-MM-DD?
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  // DD/MM/YYYY or DD-MM-YYYY
  const dm = /^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/.exec(s);
  if (dm) {
    const d = dm[1].padStart(2, "0");
    const m = dm[2].padStart(2, "0");
    return `${dm[3]}-${m}-${d}`;
  }
  // Fallback: try Date.parse
  const parsed = new Date(s);
  if (!Number.isNaN(parsed.getTime())) {
    return parsed.toISOString().slice(0, 10);
  }
  return null;
}

// POST /api/ptm-notes/import — multipart/form-data upload.
// Fields: file, class_id, exam_type_id (optional), dry_run ("true" | "false")
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

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json(
      { error: "Expected multipart/form-data" },
      { status: 400 }
    );
  }

  const file = form.get("file");
  const classId = String(form.get("class_id") ?? "");
  const examTypeIdRaw = String(form.get("exam_type_id") ?? "");
  const examTypeId = examTypeIdRaw ? examTypeIdRaw : null;
  const dryRun = String(form.get("dry_run") ?? "true") !== "false";

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Missing file" }, { status: 400 });
  }
  if (!classId) {
    return NextResponse.json({ error: "class_id is required" }, { status: 400 });
  }

  const { data: enrollments } = await supabase
    .from("student_enrollments")
    .select("student_id, roll_number, students(full_name, admission_no)")
    .eq("class_id", classId)
    .eq("status", "active");

  const byAdmission = new Map<
    string,
    { student_id: string; full_name: string }
  >();
  const byRoll = new Map<
    string,
    { student_id: string; full_name: string }
  >();
  for (const e of enrollments ?? []) {
    const s = e.students as unknown as {
      full_name: string;
      admission_no: string;
    };
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

  const buf = await file.arrayBuffer();
  let workbook: XLSX.WorkBook;
  try {
    workbook = XLSX.read(new Uint8Array(buf), { type: "array", cellDates: true });
  } catch (err) {
    console.error("XLSX parse error:", err);
    return NextResponse.json({ error: "Could not parse file" }, { status: 400 });
  }
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) {
    return NextResponse.json({ error: "File has no sheets" }, { status: 400 });
  }
  const sheet = workbook.Sheets[sheetName];

  const rawRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
    defval: "",
    raw: true,
  });

  const normalized: ParsedRow[] = rawRows.map((r) => {
    const out: ParsedRow = {};
    for (const k of Object.keys(r)) {
      const nk = normalizeKey(k);
      const v = r[k];
      switch (nk) {
        case "admission_no":
        case "admissionno":
        case "admission":
          out.admission_no = String(v ?? "").trim();
          break;
        case "roll_number":
        case "rollno":
        case "roll":
          out.roll_number = v as string | number;
          break;
        case "student_name":
        case "name":
          out.student_name = String(v ?? "").trim();
          break;
        case "meeting_date":
        case "date":
          out.meeting_date = v as string | number;
          break;
        case "attendance":
        case "status":
          out.attendance = String(v ?? "").trim().toLowerCase();
          break;
        case "teacher_remarks":
        case "remarks":
          out.teacher_remarks = String(v ?? "");
          break;
        case "parent_remarks":
          out.parent_remarks = String(v ?? "");
          break;
        case "action_points":
        case "actions":
          out.action_points = String(v ?? "");
          break;
        default:
          break;
      }
    }
    return out;
  });

  const seen = new Set<string>(); // `${student_id}|${meeting_date}` dedupe

  const results: RowResult[] = normalized.map((row, i) => {
    const admission = (row.admission_no ?? "").trim();
    const rollRaw = row.roll_number ?? "";
    const roll = rollRaw === "" ? "" : String(rollRaw).trim();
    const name = row.student_name ?? "";
    const meetingDate = parseDateValue(row.meeting_date);
    const attendance = (row.attendance ?? "").trim().toLowerCase();

    const base = {
      index: i + 2, // header row = 1, first data row = 2
      admission_no: admission,
      roll_number: roll,
      student_name: name,
      meeting_date: meetingDate ?? String(row.meeting_date ?? ""),
      attendance,
      teacher_remarks: row.teacher_remarks ? row.teacher_remarks : null,
      parent_remarks: row.parent_remarks ? row.parent_remarks : null,
      action_points: row.action_points ? row.action_points : null,
    };

    if (!meetingDate) {
      return {
        ...base,
        ok: false,
        error: "meeting_date is missing or unrecognised (use YYYY-MM-DD)",
      };
    }
    if (attendance !== "present" && attendance !== "absent") {
      return {
        ...base,
        ok: false,
        error: `attendance must be "present" or "absent"`,
      };
    }

    let match = admission ? byAdmission.get(admission) : undefined;
    if (!match && roll) match = byRoll.get(roll);
    if (!match) {
      return {
        ...base,
        ok: false,
        error: admission
          ? `No enrolled student with admission "${admission}"`
          : roll
            ? `No enrolled student with roll ${roll}`
            : "Provide admission_no or roll_number",
      };
    }

    const dedupeKey = `${match.student_id}|${meetingDate}`;
    if (seen.has(dedupeKey)) {
      return {
        ...base,
        ok: false,
        error: "Duplicate (student, meeting_date) in this upload",
      };
    }
    seen.add(dedupeKey);

    return {
      ...base,
      ok: true,
      matched_student_id: match.student_id,
    };
  });

  const errorCount = results.filter((r) => !r.ok).length;
  const appliedRows = results.filter((r) => r.ok && r.matched_student_id);

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

  // Commit path — upsert in one call.
  const records = appliedRows.map((r) => ({
    student_id: r.matched_student_id!,
    exam_type_id: examTypeId,
    meeting_date: r.meeting_date,
    attendance: r.attendance,
    teacher_remarks: r.teacher_remarks ?? null,
    parent_remarks: r.parent_remarks ?? null,
    action_points: r.action_points ?? null,
    recorded_by: user.id,
  }));

  const { error } = await supabase
    .from("ptm_notes")
    .upsert(records, { onConflict: "student_id,meeting_date" });

  if (error) {
    console.error("[ptm-notes.import.POST] bulk upsert:", error);
    return NextResponse.json(
      {
        summary: {
          total: results.length,
          to_apply: appliedRows.length,
          errors: errorCount,
          committed: 0,
          dry_run: false,
          commit_error: "Failed to commit PTM notes import",
        },
        rows: results,
      },
      { status: 500 }
    );
  }

  return NextResponse.json({
    summary: {
      total: results.length,
      to_apply: appliedRows.length,
      errors: errorCount,
      committed: records.length,
      dry_run: false,
    },
    rows: results,
  });
}
