// POST /api/fees/historical-import
//
// Bulk-imports payment rows from the previous ERP software's "Day Book
// (Account Wise) Report" XLSX. Two-phase flow:
//   1. Client uploads with dry_run="true" → server returns row-level preview
//      plus a list of distinct raw_class names that the built-in normalizer
//      didn't recognize. UI asks the admin to map each unknown class.
//   2. Client uploads with dry_run="false" plus `class_mappings` JSON →
//      server resolves every row, auto-creates supporting records (fee
//      structures + classes if needed), and bulk-inserts payments tagged
//      with `source='historical_import'` + a fresh `import_batch_id`.
//
// All inserts use the original receipt# prefixed with `HIST-{YYYY}-` to
// guarantee uniqueness, payment_method='historical_unknown' (the old
// software didn't record it), and idempotency via ON CONFLICT on the
// unique `receipt_number`.

import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { verifyAdminOrEditorWithUser } from "@nkps/shared/lib/verify-admin";
import {
  parseAccountWiseFees,
  normalizeClassNameWithOverrides,
  type NormalizedClass,
  type ParsedFeeRow,
  type ParsedFeePayment,
} from "@nkps/shared/lib/historical-import";

const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

interface RowResult {
  source_row: number;
  raw_class: string;
  raw_section: string;
  admission_no: string | null;
  student_name: string;
  payments_count: number;
  total: number;
  ok: boolean;
  error?: string;
  resolved_student_id?: string;
  resolved_class_id?: string;
  matched_by?: "admission_no" | "name_fallback";
}

export async function POST(req: NextRequest) {
  const auth = await verifyAdminOrEditorWithUser("fees");
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { admin, user } = auth;

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json(
      { error: "Expected multipart/form-data" },
      { status: 400 }
    );
  }

  const file = form.get("file");
  const academicYearId = String(form.get("academic_year_id") ?? "");
  const dryRun = String(form.get("dry_run") ?? "true") !== "false";
  const nameFallback = String(form.get("name_fallback") ?? "true") !== "false";
  let classMappings: Record<string, NormalizedClass> = {};
  const rawMappings = form.get("class_mappings");
  if (typeof rawMappings === "string" && rawMappings.trim()) {
    try {
      classMappings = JSON.parse(rawMappings);
    } catch {
      return NextResponse.json(
        { error: "class_mappings must be valid JSON" },
        { status: 400 }
      );
    }
  }

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Missing file" }, { status: 400 });
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return NextResponse.json(
      { error: `File exceeds ${MAX_UPLOAD_BYTES / 1024 / 1024} MB limit` },
      { status: 413 }
    );
  }
  if (!academicYearId) {
    return NextResponse.json(
      { error: "academic_year_id is required" },
      { status: 400 }
    );
  }

  // Confirm the academic year exists.
  const { data: yearRow, error: yearErr } = await admin
    .from("academic_years")
    .select("id, name")
    .eq("id", academicYearId)
    .maybeSingle();
  if (yearErr || !yearRow) {
    return NextResponse.json(
      { error: "academic_year_id not found" },
      { status: 400 }
    );
  }
  const academicYearName = yearRow.name as string;
  // Extract the start-year for the HIST-{YYYY}- receipt prefix (e.g. "2025-26" → "2025").
  const yearPrefix = (academicYearName.match(/(\d{4})/)?.[1]) ?? "0000";

  // Parse the XLSX.
  let parsed: ReturnType<typeof parseAccountWiseFees>;
  try {
    const buf = await file.arrayBuffer();
    parsed = parseAccountWiseFees(buf);
  } catch (err) {
    return NextResponse.json(
      {
        error: "Failed to parse XLSX",
        details: err instanceof Error ? err.message : String(err),
      },
      { status: 400 }
    );
  }
  const sourceRows = parsed.rows;
  if (sourceRows.length === 0) {
    return NextResponse.json({
      summary: emptySummary(true),
      rows: [],
      unmapped_classes: [],
      warnings: parsed.warnings,
    });
  }

  // Resolve all raw_class strings via map + overrides. Collect the set of
  // unmapped names so the UI can ask for a mapping.
  const classResolution = new Map<string, NormalizedClass | null>();
  const unmappedClasses = new Set<string>();
  for (const r of sourceRows) {
    if (classResolution.has(r.raw_class)) continue;
    const norm = normalizeClassNameWithOverrides(r.raw_class, classMappings);
    classResolution.set(r.raw_class, norm);
    if (!norm) unmappedClasses.add(r.raw_class);
  }

  // Load lookups in parallel:
  //   - Streams by name (so we can resolve the stream_id when class has a stream).
  //   - Classes for the target academic year.
  //   - Students by admission_no.
  //   - Existing fee_payments receipts (for the unique check on commit — we'll
  //     also lean on ON CONFLICT, but pre-check enables clearer dry-run output).
  const [streamsRes, classesRes, studentsRes] = await Promise.all([
    admin.from("streams").select("id, name"),
    admin
      .from("classes")
      .select("id, name, section, stream_id")
      .eq("academic_year_id", academicYearId),
    admin.from("students").select("id, admission_no, full_name, father_name"),
  ]);
  if (streamsRes.error) {
    return NextResponse.json({ error: streamsRes.error.message }, { status: 500 });
  }
  if (classesRes.error) {
    return NextResponse.json({ error: classesRes.error.message }, { status: 500 });
  }
  if (studentsRes.error) {
    return NextResponse.json({ error: studentsRes.error.message }, { status: 500 });
  }

  const streamByName = new Map<string, string>();
  for (const s of streamsRes.data ?? []) {
    streamByName.set(s.name.toLowerCase(), s.id as string);
  }

  type ClassRow = { id: string; name: string; section: string; stream_id: string | null };
  const classesByKey = new Map<string, ClassRow>();
  for (const c of (classesRes.data ?? []) as ClassRow[]) {
    classesByKey.set(classKey(c.name, c.section, c.stream_id), c);
  }

  const studentsByAdm = new Map<string, { id: string; full_name: string; father_name: string | null }>();
  type StudentLite = { id: string; full_name: string; father_name: string | null };
  const studentsByNameKey = new Map<string, StudentLite[]>();
  for (const s of studentsRes.data ?? []) {
    const lite: StudentLite = {
      id: s.id as string,
      full_name: (s.full_name as string) ?? "",
      father_name: (s.father_name as string | null) ?? null,
    };
    if (s.admission_no) studentsByAdm.set(String(s.admission_no), lite);
    const nameKey = nameLookupKey(lite.full_name, lite.father_name);
    if (nameKey) {
      const arr = studentsByNameKey.get(nameKey) ?? [];
      arr.push(lite);
      studentsByNameKey.set(nameKey, arr);
    }
  }

  // Per-row resolution. Classes (and streams, if needed) are auto-created
  // during commit — they're deterministic from the source data, so an OK row
  // is one whose class either exists or *can be* created. We track the spec
  // and materialize the real class_id at commit time.
  const rowResults: RowResult[] = [];
  const resolvedRows: Array<{
    src: ParsedFeeRow;
    student_id: string;
    class_spec_key: string;
    norm: NormalizedClass;
    section: string;
  }> = [];

  // Track distinct specs that will need to exist before commit can run.
  type ClassSpec = { name: string; section: string; stream_name: string | null };
  const classSpecByKey = new Map<string, ClassSpec>();

  for (const r of sourceRows) {
    const norm = classResolution.get(r.raw_class) ?? null;
    if (!norm) {
      rowResults.push(rowError(r, `Unmapped class "${r.raw_class}". Provide a mapping.`));
      continue;
    }

    const section = r.raw_section || "A";
    const spec: ClassSpec = {
      name: norm.class_name,
      section,
      stream_name: norm.stream_name,
    };
    const sKey = `${spec.name}::${spec.section.toUpperCase()}::${spec.stream_name ?? ""}`;
    if (!classSpecByKey.has(sKey)) classSpecByKey.set(sKey, spec);

    // Resolve student.
    let studentId: string | null = null;
    let matchedBy: "admission_no" | "name_fallback" | undefined;
    if (r.admission_no) {
      const s = studentsByAdm.get(r.admission_no);
      if (s) {
        studentId = s.id;
        matchedBy = "admission_no";
      }
    }
    if (!studentId && nameFallback && r.student_name) {
      const key = nameLookupKey(r.student_name, r.father_name);
      const candidates = key ? studentsByNameKey.get(key) ?? [] : [];
      if (candidates.length === 1) {
        studentId = candidates[0].id;
        matchedBy = "name_fallback";
      } else if (candidates.length > 1) {
        rowResults.push(
          rowError(
            r,
            `Ambiguous name match: ${candidates.length} students with same name + father. Fill in SR No in the source file.`
          )
        );
        continue;
      }
    }
    if (!studentId) {
      rowResults.push(
        rowError(
          r,
          r.admission_no
            ? `Student not found in ERP for admission_no=${r.admission_no}. Add the student first.`
            : `No admission_no and no name match for "${r.student_name}". Fill in SR No in the source file or add the student.`
        )
      );
      continue;
    }

    if (r.payments.length === 0) {
      rowResults.push(rowError(r, "Row has no payments to import."));
      continue;
    }

    rowResults.push({
      source_row: r.source_row,
      raw_class: r.raw_class,
      raw_section: r.raw_section,
      admission_no: r.admission_no,
      student_name: r.student_name,
      payments_count: r.payments.length,
      total: r.total,
      ok: true,
      resolved_student_id: studentId,
      matched_by: matchedBy,
    });

    resolvedRows.push({
      src: r,
      student_id: studentId,
      class_spec_key: sKey,
      norm,
      section,
    });
  }

  const okRows = rowResults.filter((r) => r.ok);
  const errorRows = rowResults.filter((r) => !r.ok);
  const paymentsToCreate = resolvedRows.reduce(
    (acc, r) => acc + r.src.payments.length,
    0
  );

  // Count entities that will be auto-created (informational for dry-run).
  const willCreateStreams: string[] = [];
  for (const spec of classSpecByKey.values()) {
    if (!spec.stream_name) continue;
    if (!streamByName.has(spec.stream_name.toLowerCase()) && !willCreateStreams.includes(spec.stream_name)) {
      willCreateStreams.push(spec.stream_name);
    }
  }
  const willCreateClasses: Array<{ name: string; section: string; stream_name: string | null }> = [];
  for (const spec of classSpecByKey.values()) {
    const sid = spec.stream_name
      ? streamByName.get(spec.stream_name.toLowerCase()) ?? null
      : null;
    // Either the stream doesn't exist (so the class can't either) OR the class itself doesn't exist.
    const classMissing =
      (spec.stream_name && !sid) ||
      !classesByKey.has(classKey(spec.name, spec.section, sid));
    if (classMissing) {
      willCreateClasses.push({
        name: spec.name,
        section: spec.section,
        stream_name: spec.stream_name,
      });
    }
  }

  // If dry-run OR any errors OR any unmapped classes → do not commit.
  if (dryRun || errorRows.length > 0 || unmappedClasses.size > 0) {
    return NextResponse.json({
      summary: {
        total_rows: sourceRows.length,
        ok_rows: okRows.length,
        error_rows: errorRows.length,
        payments_to_create: paymentsToCreate,
        will_create_streams: willCreateStreams,
        will_create_classes: willCreateClasses,
        dry_run: true,
        committed: false,
        unmapped_classes: [...unmappedClasses],
      },
      rows: rowResults,
      unmapped_classes: [...unmappedClasses],
      warnings: parsed.warnings,
    });
  }

  // --- COMMIT PATH -----------------------------------------------------
  const batchId = randomUUID();

  // 0a. Materialize any missing streams first.
  if (willCreateStreams.length > 0) {
    const { data: insertedStreams, error: streamInsErr } = await admin
      .from("streams")
      .insert(willCreateStreams.map((name) => ({ name })))
      .select("id, name");
    if (streamInsErr) {
      return NextResponse.json(
        { error: `Failed to create streams: ${streamInsErr.message}` },
        { status: 500 }
      );
    }
    for (const s of insertedStreams ?? []) {
      streamByName.set((s.name as string).toLowerCase(), s.id as string);
    }
  }

  // 0b. Materialize any missing classes.
  const classesToCreate: Array<{
    name: string;
    section: string;
    academic_year_id: string;
    stream_id: string | null;
    sort_order: number;
  }> = [];
  for (const spec of classSpecByKey.values()) {
    const sid = spec.stream_name
      ? streamByName.get(spec.stream_name.toLowerCase()) ?? null
      : null;
    if (classesByKey.has(classKey(spec.name, spec.section, sid))) continue;
    classesToCreate.push({
      name: spec.name,
      section: spec.section,
      academic_year_id: academicYearId,
      stream_id: sid,
      sort_order: 0,
    });
  }
  if (classesToCreate.length > 0) {
    const { data: insertedClasses, error: classInsErr } = await admin
      .from("classes")
      .insert(classesToCreate)
      .select("id, name, section, stream_id");
    if (classInsErr) {
      return NextResponse.json(
        { error: `Failed to create classes: ${classInsErr.message}` },
        { status: 500 }
      );
    }
    for (const c of (insertedClasses ?? []) as ClassRow[]) {
      classesByKey.set(classKey(c.name, c.section, c.stream_id), c);
    }
  }

  // 0c. Build spec_key → class_id resolver.
  const classIdBySpec = new Map<string, string>();
  for (const [sKey, spec] of classSpecByKey) {
    const sid = spec.stream_name
      ? streamByName.get(spec.stream_name.toLowerCase()) ?? null
      : null;
    const c = classesByKey.get(classKey(spec.name, spec.section, sid));
    if (c) classIdBySpec.set(sKey, c.id);
  }

  // 1. Auto-upsert one fee_structures row per (academic_year, class) bucket.
  //    Idempotent via fee_type='Historical' + class_name + academic_year_id.
  const distinctBuckets = new Map<string, { class_name: string; stream_id: string | null }>();
  for (const r of resolvedRows) {
    const streamIdForBucket = streamByName.get((r.norm.stream_name ?? "").toLowerCase()) ?? null;
    const key = `${r.norm.class_name}::${streamIdForBucket ?? ""}`;
    distinctBuckets.set(key, {
      class_name: r.norm.class_name,
      stream_id: streamIdForBucket,
    });
  }

  // Look up existing historical fee_structures for these buckets.
  const { data: existingStructures, error: estErr } = await admin
    .from("fee_structures")
    .select("id, class_name, stream_id")
    .eq("academic_year_id", academicYearId)
    .eq("fee_type", "Historical");
  if (estErr) {
    return NextResponse.json({ error: estErr.message }, { status: 500 });
  }
  const structureByBucket = new Map<string, string>();
  for (const s of existingStructures ?? []) {
    structureByBucket.set(
      `${s.class_name}::${s.stream_id ?? ""}`,
      s.id as string
    );
  }

  // Insert any missing buckets.
  const missingBuckets = [...distinctBuckets.entries()].filter(
    ([k]) => !structureByBucket.has(k)
  );
  if (missingBuckets.length > 0) {
    const toInsert = missingBuckets.map(([, b]) => ({
      academic_year_id: academicYearId,
      class_name: b.class_name,
      stream_id: b.stream_id,
      fee_type: "Historical",
      amount: 0,
      frequency: "one_time",
      description: `Bucket for payments imported from the previous ERP software (${academicYearName}).`,
      is_active: false,
    }));
    const { data: inserted, error: insErr } = await admin
      .from("fee_structures")
      .insert(toInsert)
      .select("id, class_name, stream_id");
    if (insErr) {
      return NextResponse.json(
        { error: `Failed to create historical fee structures: ${insErr.message}` },
        { status: 500 }
      );
    }
    for (const s of inserted ?? []) {
      structureByBucket.set(`${s.class_name}::${s.stream_id ?? ""}`, s.id as string);
    }
  }

  // 2. Flatten resolved rows into fee_payments insert payload.
  const paymentsPayload: Array<Record<string, unknown>> = [];
  for (const r of resolvedRows) {
    const streamIdForBucket = streamByName.get((r.norm.stream_name ?? "").toLowerCase()) ?? null;
    const bucketKey = `${r.norm.class_name}::${streamIdForBucket ?? ""}`;
    const structureId = structureByBucket.get(bucketKey);
    if (!structureId) {
      // Shouldn't happen — we just created them. Defensive guard.
      continue;
    }
    for (const p of r.src.payments) {
      paymentsPayload.push(buildPaymentRow({
        student_id: r.student_id,
        fee_structure_id: structureId,
        academic_year_id: academicYearId,
        payment: p,
        receipt_year_prefix: yearPrefix,
        recorded_by: user.id,
        batch_id: batchId,
      }));
    }
  }

  // 3. Bulk-insert in chunks of 500, ignoring receipt# conflicts (idempotent).
  let committed = 0;
  let skippedConflicts = 0;
  const insertErrors: string[] = [];
  for (let i = 0; i < paymentsPayload.length; i += 500) {
    const chunk = paymentsPayload.slice(i, i + 500);
    const { data: inserted, error: chunkErr } = await admin
      .from("fee_payments")
      .upsert(chunk, { onConflict: "receipt_number", ignoreDuplicates: true })
      .select("id");
    if (chunkErr) {
      insertErrors.push(chunkErr.message);
      continue;
    }
    const insertedCount = (inserted ?? []).length;
    committed += insertedCount;
    skippedConflicts += chunk.length - insertedCount;
  }

  if (insertErrors.length > 0 && committed === 0) {
    return NextResponse.json(
      {
        error: "Insert failed",
        details: insertErrors.slice(0, 5).join("; "),
      },
      { status: 500 }
    );
  }

  return NextResponse.json({
    summary: {
      total_rows: sourceRows.length,
      ok_rows: okRows.length,
      error_rows: errorRows.length,
      payments_to_create: paymentsPayload.length,
      committed,
      skipped_conflicts: skippedConflicts,
      dry_run: false,
      batch_id: batchId,
      unmapped_classes: [],
    },
    rows: rowResults,
    warnings: [...parsed.warnings, ...insertErrors],
  });
}

// ----- helpers -------------------------------------------------------

function classKey(name: string, section: string, streamId: string | null): string {
  return `${name.trim().toUpperCase()}::${(section ?? "").trim().toUpperCase()}::${streamId ?? ""}`;
}

function nameLookupKey(fullName: string, fatherName: string | null): string | null {
  const a = (fullName ?? "").trim().toUpperCase().replace(/\s+/g, " ");
  const b = (fatherName ?? "").trim().toUpperCase().replace(/\s+/g, " ");
  if (!a) return null;
  return `${a}|${b}`;
}

function rowError(r: ParsedFeeRow, msg: string): RowResult {
  return {
    source_row: r.source_row,
    raw_class: r.raw_class,
    raw_section: r.raw_section,
    admission_no: r.admission_no,
    student_name: r.student_name,
    payments_count: r.payments.length,
    total: r.total,
    ok: false,
    error: msg,
  };
}

function emptySummary(dryRun: boolean) {
  return {
    total_rows: 0,
    ok_rows: 0,
    error_rows: 0,
    payments_to_create: 0,
    dry_run: dryRun,
    committed: false,
    unmapped_classes: [] as string[],
  };
}

function buildPaymentRow(args: {
  student_id: string;
  fee_structure_id: string;
  academic_year_id: string;
  payment: ParsedFeePayment;
  receipt_year_prefix: string;
  recorded_by: string;
  batch_id: string;
}): Record<string, unknown> {
  const { student_id, fee_structure_id, academic_year_id, payment, receipt_year_prefix, recorded_by, batch_id } = args;
  return {
    student_id,
    fee_structure_id,
    academic_year_id,
    amount_paid: payment.amount,
    payment_method: "historical_unknown",
    payment_date: payment.payment_date,
    month: payment.month,
    receipt_number: `HIST-${receipt_year_prefix}-${payment.original_receipt}`,
    status: "paid",
    recorded_by,
    remarks: `Imported from previous ERP software. Original receipt #${payment.original_receipt}. Month column: ${payment.month}.`,
    source: "historical_import",
    import_batch_id: batch_id,
  };
}
