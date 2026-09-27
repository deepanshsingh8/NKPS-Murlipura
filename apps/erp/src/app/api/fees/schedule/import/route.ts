import { NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { verifyAdminOrEditorWithUser } from "@nkps/shared/lib/verify-admin";
import {
  mapFeeTemplateHeaders,
  parseFeeAmount,
  parseFeeDate,
  parseStudentType,
} from "@nkps/shared/lib/fee-template";
import { feeScheduleRowSchema } from "@nkps/shared/lib/validations";

// POST /api/fees/schedule/import  (multipart: file, academic_year_id)
//
// Parse + validate ONLY — this endpoint never writes. It returns a per-row
// verdict and the (class, stream) buckets the file resolves to; the client
// then commits each bucket through the existing POST /api/fees/schedule,
// which already reconciles a whole grid. Keeping one write path means the
// insert/update/deactivate rules (and the FK fallback that protects issued
// receipts) cannot drift between the grid editor and the importer.

const MAX_UPLOAD_BYTES = 2 * 1024 * 1024;

interface RowVerdict {
  source_row: number;
  class_name: string;
  stream_name: string | null;
  fee_type: string;
  instalment_name: string | null;
  amount: number | null;
  due_date: string | null;
  student_type: string;
  status: "ok" | "warning" | "error";
  message?: string;
}

export async function POST(request: Request) {
  const auth = await verifyAdminOrEditorWithUser("fees");
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { admin } = auth;

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
  const academicYearId = String(form.get("academic_year_id") ?? "");

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "No file uploaded" }, { status: 400 });
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return NextResponse.json(
      { error: "File is larger than 2 MB" },
      { status: 400 }
    );
  }
  if (!academicYearId) {
    return NextResponse.json(
      { error: "Select an academic year" },
      { status: 400 }
    );
  }

  const { data: year } = await admin
    .from("academic_years")
    .select("id, name")
    .eq("id", academicYearId)
    .maybeSingle();
  if (!year) {
    return NextResponse.json(
      { error: "Academic year not found" },
      { status: 400 }
    );
  }

  // ── Parse the sheet ──
  let sheetRows: unknown[][];
  try {
    const wb = XLSX.read(await file.arrayBuffer(), { type: "array" });
    const first = wb.SheetNames[0];
    if (!first) throw new Error("empty workbook");
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

  const headers = (sheetRows[0] ?? []).map((c) => String(c ?? ""));
  const { mapping, unrecognized, missingRequired } =
    mapFeeTemplateHeaders(headers);

  if (missingRequired.length > 0) {
    return NextResponse.json(
      {
        error: `The sheet is missing required column(s): ${missingRequired.join(", ")}. Download the template to see the expected headers.`,
        unrecognized_headers: unrecognized,
      },
      { status: 400 }
    );
  }

  // Streams, so "Science" in a sheet resolves to a stream_id. Names only —
  // never make the admin paste a UUID.
  // kind='stream' only: the `streams` table also holds wings (migration 118).
  // This map decides fee_structures.stream_id, so a wing matched here would
  // change what students are charged.
  const { data: streams } = await admin
    .from("streams")
    .select("id, name")
    .eq("kind", "stream");
  const streamByName = new Map(
    (streams ?? []).map((s) => [String(s.name).trim().toLowerCase(), s.id as string])
  );

  const verdicts: RowVerdict[] = [];
  // bucketKey → rows in the shape feeScheduleRowSchema expects
  const buckets = new Map<
    string,
    {
      class_name: string;
      stream_id: string | null;
      stream_name: string | null;
      rows: Record<string, unknown>[];
    }
  >();

  for (let i = 1; i < sheetRows.length; i++) {
    const raw = sheetRows[i] ?? [];
    const cell = (key: string): unknown => {
      const idx = Object.entries(mapping).find(([, k]) => k === key)?.[0];
      return idx === undefined ? undefined : raw[Number(idx)];
    };

    const className = String(cell("class_name") ?? "").trim();
    const streamName = String(cell("stream_name") ?? "").trim() || null;
    const feeType = String(cell("fee_type") ?? "").trim();

    // A wholly blank line in the middle of a sheet is padding, not an error.
    if (!className && !feeType && !cell("amount")) continue;

    const amount = parseFeeAmount(cell("amount"));
    const dueDate = parseFeeDate(cell("due_date"));
    const studentType = parseStudentType(cell("student_type"));
    const instalmentName = String(cell("instalment_name") ?? "").trim() || null;

    const base: RowVerdict = {
      source_row: i + 1, // 1-indexed, counting the header
      class_name: className,
      stream_name: streamName,
      fee_type: feeType,
      instalment_name: instalmentName,
      amount: Number.isFinite(amount) ? amount : null,
      due_date: dueDate,
      student_type: studentType,
      status: "ok",
    };

    const fail = (message: string) => {
      verdicts.push({ ...base, status: "error", message });
    };

    if (!className) {
      fail("Class is blank");
      continue;
    }
    if (!feeType) {
      fail("Fee Head is blank");
      continue;
    }
    if (!Number.isFinite(amount) || amount <= 0) {
      fail("Amount must be a number greater than 0");
      continue;
    }
    if (!dueDate) {
      fail("Due Date is missing or not a date (use DD/MM/YYYY)");
      continue;
    }

    let streamId: string | null = null;
    if (streamName) {
      streamId = streamByName.get(streamName.toLowerCase()) ?? null;
      if (!streamId) {
        fail(`Stream "${streamName}" does not exist`);
        continue;
      }
    }

    const lateStart = parseFeeDate(cell("late_fee_start_date"));
    const perDay = parseFeeAmount(cell("late_fee_per_day"));
    const maxLate = parseFeeAmount(cell("late_fee_max"));
    const instalmentNoRaw = parseFeeAmount(cell("instalment_no"));

    const scheduleRow: Record<string, unknown> = {
      fee_type: feeType,
      due_date: dueDate,
      instalment_name: instalmentName ?? "",
      amount,
      student_type: studentType,
      month_label: String(cell("month_label") ?? "").trim() || "",
      late_fee_start_date: lateStart,
      late_fee_per_day: Number.isFinite(perDay) ? perDay : 0,
      late_fee_max: Number.isFinite(maxLate) ? maxLate : null,
    };

    // Validate against the very schema the commit endpoint will apply, so the
    // preview cannot say "ok" for a row that is then rejected on save.
    const check = feeScheduleRowSchema.safeParse(scheduleRow);
    if (!check.success) {
      fail(
        check.error.issues[0]?.message ?? "Row failed validation"
      );
      continue;
    }

    if (Number.isFinite(instalmentNoRaw)) {
      scheduleRow.instalment_no = instalmentNoRaw;
    }

    const bucketKey = `${className}|${streamId ?? ""}`;
    const bucket = buckets.get(bucketKey) ?? {
      class_name: className,
      stream_id: streamId,
      stream_name: streamName,
      rows: [],
    };

    // Two rows with the same head, due date and audience would double-bill.
    // The commit schema rejects it too, but catching it here names the row.
    const dupKey = `${feeType}|${dueDate}|${studentType}`;
    const clash = bucket.rows.find(
      (r) => `${r.fee_type}|${r.due_date}|${r.student_type}` === dupKey
    );
    if (clash) {
      fail(
        `Duplicate: ${feeType} due ${dueDate} for "${studentType}" already appears in ${className}${streamName ? ` (${streamName})` : ""}`
      );
      continue;
    }

    bucket.rows.push(scheduleRow);
    buckets.set(bucketKey, bucket);
    verdicts.push(base);
  }

  const errorCount = verdicts.filter((v) => v.status === "error").length;
  const bucketList = Array.from(buckets.values());

  // Which of these classes already have a schedule? Replacing one is a
  // heavier action than creating one, and the admin should see that before
  // confirming rather than after.
  const classNames = [...new Set(bucketList.map((b) => b.class_name))];
  const existingByBucket = new Map<string, number>();
  if (classNames.length > 0) {
    const { data: existing } = await admin
      .from("fee_structures")
      .select("class_name, stream_id")
      .eq("academic_year_id", academicYearId)
      .eq("is_active", true)
      .in("class_name", classNames);
    for (const row of existing ?? []) {
      const key = `${row.class_name}|${row.stream_id ?? ""}`;
      existingByBucket.set(key, (existingByBucket.get(key) ?? 0) + 1);
    }
  }

  return NextResponse.json({
    academic_year: { id: year.id, name: year.name },
    unrecognized_headers: unrecognized,
    rows: verdicts,
    summary: {
      total: verdicts.length,
      errors: errorCount,
      buckets: bucketList.length,
    },
    // Everything the client needs to commit, so it doesn't re-derive any of it.
    buckets: bucketList.map((b) => ({
      class_name: b.class_name,
      stream_id: b.stream_id,
      stream_name: b.stream_name,
      row_count: b.rows.length,
      replaces_existing: existingByBucket.get(`${b.class_name}|${b.stream_id ?? ""}`) ?? 0,
      payload: {
        academic_year_id: academicYearId,
        class_name: b.class_name,
        stream_id: b.stream_id,
        rows: b.rows,
      },
    })),
  });
}
