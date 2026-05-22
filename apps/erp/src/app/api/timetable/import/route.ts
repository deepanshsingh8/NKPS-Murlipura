import { NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { verifyAdminOrEditor } from "@nkps/shared/lib/verify-admin";

/**
 * §10 Excel preview: parse the uploaded .xlsx/.xls and return a fully-validated
 * preview with conflicts highlighted. NOTHING is written to the DB here —
 * the admin reviews, then commits via /api/timetable/import/commit.
 *
 * Expected columns (case-insensitive, leading/trailing whitespace stripped):
 *   Day, Period, Section, Subject, Teacher, Start, End, Room
 *
 *   Day:     Monday..Saturday OR 1..6
 *   Period:  positive integer (1..N)
 *   Section: "X-A" or "XI Science-A" or just the class name "X" (then section A)
 *   Subject: subject name OR code
 *   Teacher: full name OR employee_id (optional → will warn)
 *   Start:   HH:MM (optional → will be inferred from template if matched)
 *   End:     HH:MM (optional)
 *   Room:    free text (optional)
 *
 * Each row in the response is annotated with status: "ok" | "warning" | "error".
 */

const MAX_BYTES = 5 * 1024 * 1024; // 5 MB

const DAY_NAMES: Record<string, number> = {
  monday: 1, mon: 1,
  tuesday: 2, tue: 2,
  wednesday: 3, wed: 3,
  thursday: 4, thu: 4, thur: 4, thurs: 4,
  friday: 5, fri: 5,
  saturday: 6, sat: 6,
};

interface RawRow {
  Day?: unknown;
  Period?: unknown;
  Section?: unknown;
  Subject?: unknown;
  Teacher?: unknown;
  Start?: unknown;
  End?: unknown;
  Room?: unknown;
  [k: string]: unknown;
}

interface PreviewRow {
  row_index: number; // 1-based row in the spreadsheet (header is row 1, data starts at 2)
  day: number | null;
  period: number | null;
  class_id: string | null;
  class_label: string;
  subject_id: string | null;
  subject_label: string;
  teacher_id: string | null;
  teacher_label: string;
  start_time: string | null;
  end_time: string | null;
  room: string | null;
  status: "ok" | "warning" | "error";
  messages: string[];
}

function asString(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "string") return v.trim();
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return String(v).trim();
}

function normaliseHeader(key: string): string {
  return key.trim().toLowerCase();
}

function parseDay(raw: string): number | null {
  if (!raw) return null;
  if (/^\d+$/.test(raw)) {
    const n = parseInt(raw, 10);
    return n >= 1 && n <= 6 ? n : null;
  }
  return DAY_NAMES[raw.toLowerCase()] ?? null;
}

function parseClass(raw: string): { className: string; section: string } | null {
  if (!raw) return null;
  // Support "XI-A", "XI Science-A", "X A", "X"
  const m = raw.match(/^([^-]+?)\s*-\s*([A-Za-z]\d?)$/);
  if (m) return { className: m[1].trim(), section: m[2].toUpperCase() };
  const m2 = raw.match(/^(.+?)\s+([A-Za-z]\d?)$/);
  if (m2) return { className: m2[1].trim(), section: m2[2].toUpperCase() };
  return { className: raw.trim(), section: "A" };
}

function parseTimeCell(raw: unknown): string | null {
  if (raw == null || raw === "") return null;
  if (typeof raw === "number") {
    // Excel serial fraction-of-day → HH:MM
    const totalMin = Math.round(raw * 24 * 60);
    const hh = Math.floor(totalMin / 60) % 24;
    const mm = totalMin % 60;
    return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
  }
  const s = String(raw).trim();
  const m = s.match(/^(\d{1,2}):(\d{2})/);
  if (!m) return null;
  return `${m[1].padStart(2, "0")}:${m[2]}`;
}

export async function POST(request: Request) {
  const admin = await verifyAdminOrEditor("timetable");
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const formData = await request.formData();
  const file = formData.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "No file uploaded" }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: `File too large (max ${MAX_BYTES / 1024 / 1024} MB)` }, { status: 400 });
  }

  let workbook: XLSX.WorkBook;
  try {
    const buf = await file.arrayBuffer();
    workbook = XLSX.read(new Uint8Array(buf), { type: "array" });
  } catch {
    return NextResponse.json({ error: "Invalid Excel file" }, { status: 400 });
  }
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  if (!sheet) return NextResponse.json({ error: "Workbook has no sheets" }, { status: 400 });

  // Pull all rows with original header keys, then normalise headers
  const rawRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "" });
  if (rawRows.length === 0) {
    return NextResponse.json({ rows: [], totals: { ok: 0, warning: 0, error: 0 } });
  }

  // Build a header alias map from the first row's keys
  const firstKeys = Object.keys(rawRows[0]);
  const headerMap = new Map<string, string>();
  for (const k of firstKeys) {
    headerMap.set(normaliseHeader(k), k);
  }
  const get = (row: Record<string, unknown>, name: string) => {
    const orig = headerMap.get(name.toLowerCase());
    return orig ? row[orig] : undefined;
  };

  // Look up current academic year for class scoping
  const { data: yearRow } = await admin
    .from("academic_years")
    .select("id")
    .eq("is_current", true)
    .maybeSingle();
  const yearId = yearRow?.id ?? null;

  // Pre-fetch reference data
  const [classesRes, subjectsRes, teachersRes] = await Promise.all([
    admin.from("classes").select("id, name, section").eq("academic_year_id", yearId ?? "00000000-0000-0000-0000-000000000000"),
    admin.from("subjects").select("id, name, code, nickname").eq("is_active", true),
    admin.from("teachers").select("id, full_name, employee_id").eq("is_active", true),
  ]);

  const classByKey = new Map<string, { id: string; name: string; section: string }>();
  for (const c of (classesRes.data ?? []) as Array<{ id: string; name: string; section: string }>) {
    classByKey.set(`${c.name.toLowerCase()}|${c.section.toLowerCase()}`, c);
  }
  const subjectByName = new Map<string, { id: string; name: string }>();
  for (const s of (subjectsRes.data ?? []) as Array<{ id: string; name: string; code: string | null; nickname: string | null }>) {
    if (s.name) subjectByName.set(s.name.toLowerCase(), s);
    if (s.code) subjectByName.set(s.code.toLowerCase(), s);
    if (s.nickname) subjectByName.set(s.nickname.toLowerCase(), s);
  }
  const teacherByKey = new Map<string, { id: string; full_name: string }>();
  for (const t of (teachersRes.data ?? []) as Array<{ id: string; full_name: string; employee_id: string | null }>) {
    teacherByKey.set(t.full_name.toLowerCase(), t);
    if (t.employee_id) teacherByKey.set(t.employee_id.toLowerCase(), t);
  }

  // Conflict tracking within the spreadsheet itself
  const teacherSlotMap = new Map<string, number>(); // "day:period:teacher_id" → row_index
  const classSlotMap = new Map<string, number>();   // "class_id:day:period"   → row_index

  const preview: PreviewRow[] = [];

  rawRows.forEach((raw, i) => {
    const messages: string[] = [];
    let status: PreviewRow["status"] = "ok";

    const dayRaw = asString(get(raw as RawRow, "Day"));
    const periodRaw = asString(get(raw as RawRow, "Period"));
    const sectionRaw = asString(get(raw as RawRow, "Section"));
    const subjectRaw = asString(get(raw as RawRow, "Subject"));
    const teacherRaw = asString(get(raw as RawRow, "Teacher"));
    const startRaw = get(raw as RawRow, "Start");
    const endRaw = get(raw as RawRow, "End");
    const roomRaw = asString(get(raw as RawRow, "Room"));

    const day = parseDay(dayRaw);
    if (day == null) { messages.push(`Day "${dayRaw}" is not valid (use Monday–Saturday or 1–6)`); status = "error"; }

    const periodNum = /^\d+$/.test(periodRaw) ? parseInt(periodRaw, 10) : NaN;
    if (!Number.isInteger(periodNum) || periodNum < 1) { messages.push(`Period "${periodRaw}" must be a positive integer`); status = "error"; }

    const cls = parseClass(sectionRaw);
    let classRow: { id: string; name: string; section: string } | null = null;
    if (!cls) {
      messages.push(`Section "${sectionRaw}" is empty`); status = "error";
    } else {
      classRow = classByKey.get(`${cls.className.toLowerCase()}|${cls.section.toLowerCase()}`) ?? null;
      if (!classRow) { messages.push(`Class "${sectionRaw}" not found in current academic year`); status = "error"; }
    }

    const subjectRow = subjectRaw ? subjectByName.get(subjectRaw.toLowerCase()) ?? null : null;
    if (!subjectRaw) { messages.push("Subject is empty"); status = "error"; }
    else if (!subjectRow) { messages.push(`Subject "${subjectRaw}" not found`); status = "error"; }

    let teacherRow: { id: string; full_name: string } | null = null;
    if (teacherRaw) {
      teacherRow = teacherByKey.get(teacherRaw.toLowerCase()) ?? null;
      if (!teacherRow) { messages.push(`Teacher "${teacherRaw}" not found`); if (status !== "error") status = "warning"; }
    } else {
      messages.push("Teacher is blank — period will be created without a teacher");
      if (status !== "error") status = "warning";
    }

    const startTime = parseTimeCell(startRaw);
    const endTime = parseTimeCell(endRaw);
    if (startTime && endTime && endTime <= startTime) {
      messages.push("End time must be after start time"); status = "error";
    }
    if (!startTime || !endTime) {
      messages.push("Start/End time missing — provide times in HH:MM format");
      status = "error";
    }

    // Cross-row conflicts (within the spreadsheet)
    if (status !== "error" && day != null && periodNum) {
      if (teacherRow) {
        const tk = `${day}:${periodNum}:${teacherRow.id}`;
        if (teacherSlotMap.has(tk)) {
          messages.push(`Teacher clash with row ${teacherSlotMap.get(tk)}`); status = "error";
        } else {
          teacherSlotMap.set(tk, i + 2);
        }
      }
      if (classRow) {
        const ck = `${classRow.id}:${day}:${periodNum}`;
        if (classSlotMap.has(ck)) {
          messages.push(`Same class+day+period as row ${classSlotMap.get(ck)}`); status = "error";
        } else {
          classSlotMap.set(ck, i + 2);
        }
      }
    }

    preview.push({
      row_index: i + 2,
      day,
      period: Number.isInteger(periodNum) ? periodNum : null,
      class_id: classRow?.id ?? null,
      class_label: sectionRaw,
      subject_id: subjectRow?.id ?? null,
      subject_label: subjectRaw,
      teacher_id: teacherRow?.id ?? null,
      teacher_label: teacherRaw,
      start_time: startTime,
      end_time: endTime,
      room: roomRaw || null,
      status,
      messages,
    });
  });

  const totals = {
    ok: preview.filter((p) => p.status === "ok").length,
    warning: preview.filter((p) => p.status === "warning").length,
    error: preview.filter((p) => p.status === "error").length,
  };

  return NextResponse.json({ rows: preview, totals });
}
