import { NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { verifyAdminWithUser } from "@nkps/shared/lib/verify-admin";
import { parseFeeAmount, parseFeeDate } from "@nkps/shared/lib/fee-template";
import { validateWaiver, buildWaiverRow } from "@/lib/fee-waiver";

// POST /api/fees/waivers/import   (multipart: file, dry_run)
//
// Bulk per-student concessions. A concession IS a waiver — the same
// zero-rupee fee_payments row the single-student Waiver button writes — so
// this endpoint reuses validateWaiver/buildWaiverRow rather than introducing
// a parallel notion of "discount" that dues, no-dues certificates and
// receipts would each have to learn about separately.
//
// There is deliberately no per-student fee table: dues are computed at
// runtime from the class schedule, and a per-student override table would
// have to be consulted by every one of those readers. A waiver row already
// flows through all of them.
//
// ADMIN ONLY. Editors record concessions one at a time so each passes through
// the existing change-request approval workflow; a bulk path for editors
// would be a way around it.
//
// Two phases: dry_run=true previews every row against the live ledger and
// writes nothing; dry_run=false re-validates (the ledger may have moved) and
// inserts. A file with any error row is refused outright.

const MAX_UPLOAD_BYTES = 2 * 1024 * 1024;

interface RowVerdict {
  source_row: number;
  admission_no: string;
  student_name: string;
  fee_type: string;
  due_date: string | null;
  amount: number | null;
  reason: string;
  month: string | null;
  status: "ok" | "error";
  message?: string;
  resolved_student_id?: string;
  resolved_structure_id?: string;
}

function headerIndex(headers: string[]): Record<string, number> {
  const norm = (s: string) =>
    String(s ?? "").trim().toLowerCase().replace(/\*/g, "").replace(/[\s._-]+/g, " ").trim();
  const aliases: Record<string, string[]> = {
    admission_no: ["admission no", "admission number", "adm no", "admno", "sr no", "sr"],
    student_name: ["student name", "name", "student"],
    fee_type: ["fee head", "fee type", "head", "particulars"],
    due_date: ["due date", "due", "date"],
    amount: ["concession amount", "amount", "concession", "waiver amount", "discount"],
    reason: ["reason", "remarks", "note"],
    month: ["month", "month name", "period"],
  };
  const idx: Record<string, number> = {};
  headers.forEach((h, i) => {
    const n = norm(h);
    for (const [key, list] of Object.entries(aliases)) {
      if (idx[key] !== undefined) continue;
      if (n === norm(key) || list.some((a) => norm(a) === n)) idx[key] = i;
    }
  });
  return idx;
}

export async function POST(request: Request) {
  // ...WithUser so recorded_by carries the actor: a concession is money off a
  // bill, and it must be attributable.
  const auth = await verifyAdminWithUser();
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { admin, user } = auth;

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: "Expected multipart/form-data" }, { status: 400 });
  }

  const file = form.get("file");
  const dryRun = String(form.get("dry_run") ?? "true") === "true";

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "No file uploaded" }, { status: 400 });
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return NextResponse.json({ error: "File is larger than 2 MB" }, { status: 400 });
  }

  let sheetRows: unknown[][];
  try {
    const wb = XLSX.read(await file.arrayBuffer(), { type: "array" });
    const first = wb.SheetNames[0];
    if (!first) throw new Error("empty");
    sheetRows = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[first], {
      header: 1,
      blankrows: false,
      raw: true,
    });
  } catch {
    return NextResponse.json(
      { error: "Could not read that file — is it a valid .xlsx?" },
      { status: 400 }
    );
  }

  if (sheetRows.length < 2) {
    return NextResponse.json(
      { error: "The sheet has a header row but no data rows" },
      { status: 400 }
    );
  }

  const idx = headerIndex((sheetRows[0] ?? []).map((c) => String(c ?? "")));
  const missing = (["admission_no", "fee_type", "due_date", "amount", "reason"] as const)
    .filter((k) => idx[k] === undefined);
  if (missing.length > 0) {
    return NextResponse.json(
      {
        error: `The sheet is missing required column(s): ${missing.join(", ")}. Download the template to see the expected headers.`,
      },
      { status: 400 }
    );
  }

  // ── Resolve every admission number in one query, not one per row ──
  const admissionNos = new Set<string>();
  for (let i = 1; i < sheetRows.length; i++) {
    const v = String(sheetRows[i]?.[idx.admission_no] ?? "").trim();
    if (v) admissionNos.add(v);
  }

  const { data: studentRows } = await admin
    .from("students")
    .select("id, admission_no, full_name")
    .in("admission_no", [...admissionNos]);
  const studentByAdm = new Map(
    (studentRows ?? []).map((s) => [
      String(s.admission_no).trim(),
      { id: s.id as string, name: s.full_name as string },
    ])
  );

  // Each student's current class schedule, so a (fee head, due date) pair can
  // be resolved to the fee_structures row it names.
  const studentIds = [...studentByAdm.values()].map((s) => s.id);
  const structureByStudent = new Map<string, Map<string, string>>();

  if (studentIds.length > 0) {
    const { data: enrollments } = await admin
      .from("student_enrollments")
      .select("student_id, academic_year_id, stream_id, classes(name)")
      .in("student_id", studentIds)
      .eq("status", "active");

    const { data: structures } = await admin
      .from("fee_structures")
      .select("id, class_name, stream_id, fee_type, due_date, academic_year_id")
      .eq("is_active", true);

    for (const e of enrollments ?? []) {
      const cls = e.classes as unknown as { name: string } | { name: string }[] | null;
      const className = (Array.isArray(cls) ? cls[0]?.name : cls?.name) ?? null;
      if (!className) continue;
      const map = new Map<string, string>();
      for (const fs of structures ?? []) {
        if (fs.class_name !== className) continue;
        if (fs.academic_year_id !== e.academic_year_id) continue;
        // A stream-specific schedule applies only to that stream; a
        // whole-class one (stream_id null) applies to everyone in the class.
        if (fs.stream_id && fs.stream_id !== e.stream_id) continue;
        map.set(
          `${String(fs.fee_type).trim().toLowerCase()}|${fs.due_date}`,
          fs.id as string
        );
      }
      structureByStudent.set(e.student_id as string, map);
    }
  }

  // ── Row-by-row verdicts ──
  const verdicts: RowVerdict[] = [];
  const seen = new Set<string>();

  for (let i = 1; i < sheetRows.length; i++) {
    const raw = sheetRows[i] ?? [];
    const admissionNo = String(raw[idx.admission_no] ?? "").trim();
    const sheetName = String(raw[idx.student_name] ?? "").trim();
    const feeType = String(raw[idx.fee_type] ?? "").trim();
    const dueDate = parseFeeDate(raw[idx.due_date]);
    const amount = parseFeeAmount(raw[idx.amount]);
    const reason = String(raw[idx.reason] ?? "").trim();
    const month = idx.month !== undefined ? String(raw[idx.month] ?? "").trim() : "";

    if (!admissionNo && !feeType && !raw[idx.amount]) continue; // padding row

    const base: RowVerdict = {
      source_row: i + 1,
      admission_no: admissionNo,
      student_name: sheetName,
      fee_type: feeType,
      due_date: dueDate,
      amount: Number.isFinite(amount) ? amount : null,
      reason,
      month: month || null,
      status: "ok",
    };
    const fail = (message: string) => verdicts.push({ ...base, status: "error", message });

    if (!admissionNo) { fail("Admission No is blank"); continue; }
    if (!feeType) { fail("Fee Head is blank"); continue; }
    if (!dueDate) { fail("Due Date is missing or not a date (use DD/MM/YYYY)"); continue; }
    if (!Number.isFinite(amount) || amount <= 0) { fail("Concession Amount must be greater than 0"); continue; }
    if (reason.length < 5) { fail("Reason is required (at least 5 characters)"); continue; }

    const student = studentByAdm.get(admissionNo);
    if (!student) { fail(`No student with admission number ${admissionNo}`); continue; }

    // The name column is for the reader's benefit, but a mismatch usually
    // means the row was pasted against the wrong admission number — which
    // would hand someone else's concession to this student.
    if (
      sheetName &&
      sheetName.toLowerCase() !== student.name.toLowerCase()
    ) {
      fail(
        `Name does not match: the sheet says "${sheetName}", admission ${admissionNo} is ${student.name}`
      );
      continue;
    }

    const structureId = structureByStudent
      .get(student.id)
      ?.get(`${feeType.toLowerCase()}|${dueDate}`);
    if (!structureId) {
      fail(
        `No "${feeType}" instalment due ${dueDate} in this student's class schedule`
      );
      continue;
    }

    // Two rows in one file for the same instalment would fail the dedup check
    // one at a time; catching it here names both.
    const dupKey = `${student.id}|${structureId}|${month || ""}`;
    if (seen.has(dupKey)) {
      fail("This student already has a concession for the same instalment earlier in this file");
      continue;
    }
    seen.add(dupKey);

    // The real guard: cap against what is still owed, and one waiver per
    // (student, structure, month). Runs on the LIVE ledger, in preview and
    // again at commit, so a concession can't slip past after a payment lands.
    const check = await validateWaiver(admin, {
      student_id: student.id,
      fee_structure_id: structureId,
      waiver_amount: amount,
      waiver_reason: reason,
      month: month || null,
    });
    if (!check.ok) { fail(check.error ?? "Rejected"); continue; }

    verdicts.push({
      ...base,
      student_name: student.name,
      resolved_student_id: student.id,
      resolved_structure_id: structureId,
    });
  }

  const errorCount = verdicts.filter((v) => v.status === "error").length;
  const okRows = verdicts.filter((v) => v.status === "ok");
  const totalAmount = okRows.reduce((sum, r) => sum + (r.amount ?? 0), 0);

  if (dryRun) {
    return NextResponse.json({
      dry_run: true,
      rows: verdicts,
      summary: { total: verdicts.length, errors: errorCount, total_amount: totalAmount },
    });
  }

  if (errorCount > 0) {
    return NextResponse.json(
      {
        error: `${errorCount} row(s) still have errors. Fix them and re-upload — nothing was imported.`,
        rows: verdicts,
      },
      { status: 400 }
    );
  }

  // ── Commit ──
  // No batch id here: these become ordinary waiver receipts, and the existing
  // refund/change-request tooling is how one gets reversed. Inserted one at a
  // time so a single bad row cannot take the whole file down, and so the
  // response can say exactly which rows landed.
  let inserted = 0;
  const failures: { source_row: number; admission_no: string; message: string }[] = [];

  for (const r of okRows) {
    const recheck = await validateWaiver(admin, {
      student_id: r.resolved_student_id!,
      fee_structure_id: r.resolved_structure_id!,
      waiver_amount: r.amount!,
      waiver_reason: r.reason,
      month: r.month,
    });
    if (!recheck.ok) {
      failures.push({
        source_row: r.source_row,
        admission_no: r.admission_no,
        message: recheck.error ?? "Rejected at import time",
      });
      continue;
    }

    const row = buildWaiverRow(
      {
        student_id: r.resolved_student_id!,
        fee_structure_id: r.resolved_structure_id!,
        waiver_amount: r.amount!,
        waiver_reason: r.reason,
        month: r.month,
      },
      recheck.academic_year_id!,
      user.id
    );

    const { error } = await admin.from("fee_payments").insert(row);
    if (error) {
      console.error("[fees.waivers.import] insert:", error);
      failures.push({
        source_row: r.source_row,
        admission_no: r.admission_no,
        message: "Could not record this concession",
      });
      continue;
    }
    inserted += 1;
  }

  return NextResponse.json({
    success: failures.length === 0,
    inserted,
    failed: failures.length,
    failures,
    total_amount: okRows
      .filter((r) => !failures.some((f) => f.source_row === r.source_row))
      .reduce((sum, r) => sum + (r.amount ?? 0), 0),
  });
}
