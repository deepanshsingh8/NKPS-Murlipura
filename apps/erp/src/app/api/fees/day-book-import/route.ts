// POST /api/fees/day-book-import
//
// Backfills the ERP's fee ledger from the previous software's "Day Book Head
// wise Report" — one row per receipt, head-wise amounts, real tender types.
//
// Two phases, same endpoint, switched by the `dry_run` form field:
//   1. dry_run=true  → classify every receipt, reconcile against the file's
//                      own control totals, and report what a commit would do.
//                      Nothing is written.
//   2. dry_run=false → create any missing classes/streams, create stub
//                      students for the leavers, then insert the payment rows
//                      and register the batch.
//
// A commit is refused while any row is in error or any class/head is unmapped,
// so the operator always sees a clean preview before money moves.
//
// ── What makes a re-upload safe ────────────────────────────────────────────
// The school re-exports the day book as the year goes on, so most of any later
// file has already been imported. Every row carries `source_receipt_no` — the
// old software's own receipt number, which never changes — and migration 115
// puts a unique index on (academic_year_id, source_receipt_no, target). A
// receipt already in the ledger is classified up front and skipped; one whose
// total has CHANGED since it was imported is a conflict that blocks the commit
// rather than being written twice or silently ignored.

import { NextRequest, NextResponse } from "next/server";
import { classSortOrder } from "@nkps/shared/lib/constants";
import { randomUUID } from "node:crypto";
import { verifyAdminOrEditorWithUser } from "@nkps/shared/lib/verify-admin";
import {
  parseHeadWiseDayBook,
  normalizeClassNameWithOverrides,
  type NormalizedClass,
  type ParsedDayBookReceipt,
} from "@nkps/shared/lib/historical-import";
import type { FeeStructure } from "@nkps/shared/types";
import {
  buildStreamLookup,
  buildStreamNameGuard,
  streamNameTaken,
  resolveStreamId,
  streamIsMissing,
} from "@nkps/shared/lib/stream-alias";
import { resolveEffectiveFeeStructures, resolveStudentType } from "@/lib/fees";
import {
  allocateStudentReceipts,
  buildImportReceiptNumber,
  groupScheduleByHead,
  normalizeHead,
  type AllocatableStructure,
  type AllocationSlice,
} from "@/lib/fee-allocation";

export const maxDuration = 300; // 1,500+ receipts fan out to several thousand rows

const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;
const INSERT_CHUNK = 500;

type RowStatus =
  | "ok"
  | "error"
  | "skip_zero"
  | "already_imported"
  | "conflict"
  | "needs_review";

interface RowResult {
  source_row: number;
  receipt_no: string;
  payment_date: string | null;
  admission_no: string | null;
  student_name: string;
  raw_class: string;
  raw_section: string;
  payment_method: string;
  total: number;
  status: RowStatus;
  message?: string;
  matched_by?: "admission_no" | "name_fallback" | "will_create";
  slices?: number;
  over_allocated?: boolean;
}

interface StudentToCreate {
  admission_no: string;
  full_name: string;
  father_name: string;
  class_name: string;
  section: string;
  stream_name: string | null;
  /** Set only when the file shows they paid an admission fee — see below. */
  admission_date: string | null;
  receipts: number;
  amount: number;
}

export async function POST(req: NextRequest) {
  const auth = await verifyAdminOrEditorWithUser("fees");
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { admin, user } = auth;

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "Expected multipart/form-data" }, { status: 400 });
  }

  const file = form.get("file");
  const academicYearId = String(form.get("academic_year_id") ?? "");
  const dryRun = String(form.get("dry_run") ?? "true") !== "false";
  const nameFallback = String(form.get("name_fallback") ?? "true") !== "false";
  const createMissingStudents =
    String(form.get("create_missing_students") ?? "true") !== "false";
  const includeNeedsReview =
    String(form.get("include_needs_review") ?? "false") === "true";

  const classMappings = parseJsonField<Record<string, NormalizedClass>>(
    form.get("class_mappings")
  );
  const headMappings = parseJsonField<Record<string, string>>(form.get("head_mappings"));
  if (classMappings === undefined || headMappings === undefined) {
    return NextResponse.json(
      { error: "class_mappings and head_mappings must be valid JSON objects" },
      { status: 400 }
    );
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
    return NextResponse.json({ error: "academic_year_id is required" }, { status: 400 });
  }

  const { data: yearRow, error: yearErr } = await admin
    .from("academic_years")
    .select("id, name, start_date, end_date")
    .eq("id", academicYearId)
    .maybeSingle();
  if (yearErr || !yearRow) {
    return NextResponse.json({ error: "academic_year_id not found" }, { status: 400 });
  }
  const academicYearName = yearRow.name as string;
  const yearPrefix = academicYearName.match(/(\d{4})/)?.[1] ?? "0000";

  // ── Parse ────────────────────────────────────────────────────────────────
  let parsed: ReturnType<typeof parseHeadWiseDayBook>;
  try {
    parsed = parseHeadWiseDayBook(await file.arrayBuffer());
  } catch (err) {
    return NextResponse.json(
      {
        error: "Failed to parse the file",
        details: err instanceof Error ? err.message : String(err),
      },
      { status: 400 }
    );
  }
  const warnings = [...parsed.warnings];

  if (parsed.receipts.length === 0) {
    return NextResponse.json({
      summary: emptySummary(),
      rows: [],
      unmapped_classes: [],
      unmapped_heads: [],
      students_to_create: [],
      reconciliation: null,
      warnings,
    });
  }

  // ── Lookups, all in one round ────────────────────────────────────────────
  const [streamsRes, classesRes, studentsRes, structuresRes] = await Promise.all([
    // `kind` comes along so buildStreamLookup can skip wings (migration 118).
    admin.from("streams").select("id, name, kind"),
    admin
      .from("classes")
      .select("id, name, section, stream_id")
      .eq("academic_year_id", academicYearId),
    admin.from("students").select("id, admission_no, full_name, father_name, admission_date"),
    admin
      .from("fee_structures")
      .select("*")
      .eq("academic_year_id", academicYearId)
      .eq("is_active", true),
  ]);
  for (const res of [streamsRes, classesRes, studentsRes, structuresRes]) {
    if (res.error) return NextResponse.json({ error: res.error.message }, { status: 500 });
  }

  // Alias-aware: the file says "XI-Arts" and the school stores the stream as
  // "Humanities". A bare-name lookup misses, which silently drops every one of
  // that class's schedule rows AND makes the commit path create a second
  // stream beside the real one.
  const streamRows = (streamsRes.data ?? []).map((s) => ({
    id: s.id as string,
    name: String(s.name),
    kind: s.kind as string | null,
  }));
  const streamByName = buildStreamLookup(streamRows);
  // Names owned by a stream OR a wing. buildStreamLookup deliberately cannot
  // see wings, so without this the commit path would treat a wing's name as a
  // missing stream and insert a twin. (migration 118)
  const streamNameGuard = buildStreamNameGuard(streamRows);

  type ClassRow = { id: string; name: string; section: string; stream_id: string | null };
  const classesByKey = new Map<string, ClassRow>();
  for (const c of (classesRes.data ?? []) as ClassRow[]) {
    classesByKey.set(classKey(c.name, c.section, c.stream_id), c);
  }

  type StudentLite = {
    id: string;
    full_name: string;
    father_name: string | null;
    admission_date: string | null;
  };
  const studentsByAdm = new Map<string, StudentLite>();
  const studentsByNameKey = new Map<string, StudentLite[]>();
  for (const s of studentsRes.data ?? []) {
    const lite: StudentLite = {
      id: s.id as string,
      full_name: (s.full_name as string) ?? "",
      father_name: (s.father_name as string | null) ?? null,
      admission_date: (s.admission_date as string | null) ?? null,
    };
    if (s.admission_no) studentsByAdm.set(normalizeAdmissionNo(String(s.admission_no)), lite);
    const nk = nameLookupKey(lite.full_name, lite.father_name);
    if (nk) studentsByNameKey.set(nk, [...(studentsByNameKey.get(nk) ?? []), lite]);
  }

  const structures = (structuresRes.data ?? []) as FeeStructure[];
  const knownHeads = new Set(structures.map((s) => normalizeHead(s.fee_type)));

  // ── Resolve classes and heads; collect what the operator must map ────────
  const classResolution = new Map<string, NormalizedClass | null>();
  const unmappedClasses = new Set<string>();
  for (const r of parsed.receipts) {
    if (classResolution.has(r.raw_class)) continue;
    const norm = normalizeClassNameWithOverrides(r.raw_class, classMappings);
    classResolution.set(r.raw_class, norm);
    if (!norm) unmappedClasses.add(r.raw_class);
  }

  // A head is "known" when the published schedule carries that fee_type
  // somewhere. Heads the operator has mapped resolve to their target label.
  const headResolution = new Map<string, string>();
  const unmappedHeads = new Set<string>();
  for (const head of parsed.heads) {
    const mapped = headMappings[head] ?? head;
    headResolution.set(head, mapped);
    if (!knownHeads.has(normalizeHead(mapped))) unmappedHeads.add(head);
  }

  // ── Existing ledger state for this year ──────────────────────────────────
  // Two things are needed per student: what has already been imported (so a
  // re-upload is a no-op) and what is already sitting against each instalment
  // (so the waterfall starts on top of it rather than double-filling).
  const {
    importedByReceipt,
    settledByStudentStructure,
    nativeByStudent,
    error: ledgerError,
  } = await loadLedgerState(admin, academicYearId);
  if (ledgerError) return NextResponse.json({ error: ledgerError }, { status: 500 });

  // ── Classify every receipt ───────────────────────────────────────────────
  interface Resolved {
    src: ParsedDayBookReceipt;
    student_id: string | null; // null when the student is still to be created
    admission_no: string;
    norm: NormalizedClass;
    section: string;
  }

  const rowResults: RowResult[] = [];
  const resolved: Resolved[] = [];
  const toCreate = new Map<string, StudentToCreate>();
  const classSpecByKey = new Map<
    string,
    { name: string; section: string; stream_name: string | null }
  >();

  for (const r of parsed.receipts) {
    const base = baseRow(r);

    if (r.errors.length > 0) {
      rowResults.push({ ...base, status: "error", message: r.errors.join(" ") });
      continue;
    }
    if (!r.payment_date) {
      rowResults.push({ ...base, status: "error", message: "Receipt Date is missing." });
      continue;
    }
    if (!r.receipt_no) {
      rowResults.push({ ...base, status: "error", message: "Receipt No is missing." });
      continue;
    }

    // Zero-value receipts: fee_payments_amount_positive forbids a non-waiver
    // zero row, and they contribute nothing to any total, so they are skipped
    // rather than turned into fake waivers.
    if (r.total === 0 || r.heads.length === 0) {
      rowResults.push({
        ...base,
        status: "skip_zero",
        message: "Receipt totals zero — nothing to record.",
      });
      continue;
    }

    const prior = importedByReceipt.get(r.receipt_no);
    if (prior) {
      const same = Math.round((prior.total - r.total) * 100) === 0;
      rowResults.push({
        ...base,
        status: same ? "already_imported" : "conflict",
        message: same
          ? `Already imported (${prior.rows} row(s)).`
          : `Already imported as ₹${prior.total.toLocaleString("en-IN")}, but this ` +
            `file says ₹${r.total.toLocaleString("en-IN")}. Resolve by hand — ` +
            `either correct the receipt in the ERP or revert the batch that ` +
            `created it — then re-run.`,
      });
      continue;
    }

    const norm = classResolution.get(r.raw_class) ?? null;
    if (!norm) {
      rowResults.push({
        ...base,
        status: "error",
        message: `Unmapped class "${r.raw_class}". Provide a mapping.`,
      });
      continue;
    }

    const unknownHead = r.heads.find((h) =>
      unmappedHeads.has(h.head)
    );
    if (unknownHead) {
      rowResults.push({
        ...base,
        status: "error",
        message:
          `Fee head "${unknownHead.head}" does not match any active fee ` +
          `structure for ${academicYearName}. Map it to one of the published ` +
          `heads, or publish the schedule first.`,
      });
      continue;
    }

    const section = (r.raw_section || "A").toUpperCase();
    const sKey = `${norm.class_name}::${section}::${norm.stream_name ?? ""}`;
    if (!classSpecByKey.has(sKey)) {
      classSpecByKey.set(sKey, {
        name: norm.class_name,
        section,
        stream_name: norm.stream_name,
      });
    }

    // Student resolution: admission number, then an optional name+father
    // fallback that refuses to guess. 15+ names in the sample are shared by
    // two or three different SR numbers, so an ambiguous match is an error.
    const admKey = r.admission_no ? normalizeAdmissionNo(r.admission_no) : "";
    let student: StudentLite | undefined = admKey ? studentsByAdm.get(admKey) : undefined;
    let matchedBy: RowResult["matched_by"] = student ? "admission_no" : undefined;

    if (!student && nameFallback && r.student_name) {
      const nk = nameLookupKey(r.student_name, r.father_name);
      const candidates = nk ? studentsByNameKey.get(nk) ?? [] : [];
      if (candidates.length === 1) {
        student = candidates[0];
        matchedBy = "name_fallback";
      } else if (candidates.length > 1) {
        rowResults.push({
          ...base,
          status: "error",
          message:
            `Ambiguous name match: ${candidates.length} students share this ` +
            `name and father's name. Correct the SR No in the source file.`,
        });
        continue;
      }
    }

    if (!student) {
      if (!r.admission_no) {
        rowResults.push({
          ...base,
          status: "error",
          message: `No SR No and no name match for "${r.student_name}".`,
        });
        continue;
      }
      if (!createMissingStudents) {
        rowResults.push({
          ...base,
          status: "error",
          message:
            `No student with SR No ${r.admission_no}. Enable "create missing ` +
            `students" or add them first.`,
        });
        continue;
      }
      const existing = toCreate.get(admKey);
      const paidAdmissionFee = r.heads.some((h) => /admission/i.test(h.head));
      toCreate.set(admKey, {
        admission_no: r.admission_no.trim(),
        full_name: r.student_name,
        father_name: r.father_name,
        class_name: norm.class_name,
        section,
        stream_name: norm.stream_name,
        // Only a student who paid an admission fee is demonstrably a new
        // admission. Leave it null otherwise: resolveStudentType() then
        // returns null and feeAppliesToStudentType() bills only unrestricted
        // lines, so a returning leaver is never levied a phantom admission fee.
        admission_date: paidAdmissionFee
          ? minDate(existing?.admission_date ?? null, r.payment_date)
          : existing?.admission_date ?? null,
        receipts: (existing?.receipts ?? 0) + 1,
        amount: (existing?.amount ?? 0) + r.total,
      });
      matchedBy = "will_create";
    }

    // A student with money already entered natively this session is held back:
    // the file and the ERP may be describing the same rupees, and silent
    // double-counting is the one failure that is hard to spot afterwards.
    const native = student ? nativeByStudent.get(student.id) : undefined;
    if (native && !includeNeedsReview) {
      rowResults.push({
        ...base,
        status: "needs_review",
        matched_by: matchedBy,
        message:
          `This student already has ${native.rows} payment(s) totalling ` +
          `₹${native.total.toLocaleString("en-IN")} entered directly in the ERP ` +
          `for ${academicYearName}. Excluded until you confirm they are not the ` +
          `same money.`,
      });
      continue;
    }

    rowResults.push({ ...base, status: "ok", matched_by: matchedBy });
    resolved.push({
      src: r,
      student_id: student?.id ?? null,
      admission_no: admKey,
      norm,
      section,
    });
  }

  // ── Classes that would be created ────────────────────────────────────────
  const willCreateStreams: string[] = [];
  const willCreateClasses: Array<{ name: string; section: string; stream_name: string | null }> = [];
  for (const spec of classSpecByKey.values()) {
    if (
      streamIsMissing(streamByName, spec.stream_name) &&
      !willCreateStreams.includes(spec.stream_name!)
    ) {
      willCreateStreams.push(spec.stream_name!);
    }
    const sid = resolveStreamId(streamByName, spec.stream_name);
    if ((spec.stream_name && !sid) || !classesByKey.has(classKey(spec.name, spec.section, sid))) {
      willCreateClasses.push(spec);
    }
  }

  // ── Allocate ─────────────────────────────────────────────────────────────
  // Run on the dry run too, not only at commit. Allocation is where a receipt
  // meets the class's actual schedule, so it is where "this class has no
  // Tuition Fee instalment" surfaces — and a preview that reports clean and
  // then fails the commit wholesale is worse than no preview. The result is
  // reused verbatim when committing; nothing is recomputed.
  const allocation = allocate({
    resolved,
    structures,
    streamByName,
    studentsByAdm,
    toCreate,
    headResolution,
    settledByStudentStructure,
    year: {
      start_date: yearRow.start_date as string,
      end_date: yearRow.end_date as string,
    },
  });

  // Fold the allocation verdict back onto the rows the operator sees.
  //
  // The message is rewritten here rather than in fee-allocation.ts, which is a
  // pure module with no idea what class a receipt belongs to. Naming the class
  // is the whole value of the message: "this class's fee schedule" sends the
  // operator to a screen with fifteen classes on it and no way to tell which
  // one is short, and a stream-scoped class is worse again because XI-Arts and
  // XI-Commerce are different schedules that look identical in a list.
  const resultBySourceRow = new Map(rowResults.map((r) => [r.source_row, r]));
  for (const problem of allocation.problems) {
    const row = resultBySourceRow.get(problem.source_row);
    if (!row) continue;
    row.status = "error";
    row.message = problem.message.replace(
      "this class's fee schedule",
      `the ${row.raw_class} fee schedule`
    );
  }
  for (const [sourceRow, info] of allocation.perRow) {
    const row = resultBySourceRow.get(sourceRow);
    if (!row || row.status !== "ok") continue;
    row.slices = info.slices;
    row.over_allocated = info.over_allocated;
  }

  const counts = tally(rowResults);
  const reconciliation = buildReconciliation(parsed, rowResults);

  const blocked =
    counts.error > 0 || counts.conflict > 0 || unmappedClasses.size > 0 || unmappedHeads.size > 0;

  if (dryRun || blocked) {
    return NextResponse.json({
      summary: {
        ...counts,
        total_rows: parsed.receipts.length,
        heads: parsed.heads,
        period_start: parsed.period_start,
        period_end: parsed.period_end,
        session_label: parsed.session_label,
        will_create_streams: willCreateStreams,
        will_create_classes: willCreateClasses,
        students_to_create: toCreate.size,
        payments_to_create: allocation.slices.length,
        over_allocated_rows: rowResults.filter((r) => r.over_allocated).length,
        dry_run: true,
        committed: false,
        blocked,
      },
      rows: rowResults,
      unmapped_classes: [...unmappedClasses],
      unmapped_heads: [...unmappedHeads],
      known_heads: [...new Set(structures.map((s) => s.fee_type))].sort(),
      students_to_create: [...toCreate.values()],
      reconciliation,
      warnings,
    });
  }

  // ══ COMMIT ═══════════════════════════════════════════════════════════════
  const batchId = randomUUID();

  const materialized = await materializeClasses(admin, {
    academicYearId,
    classSpecByKey,
    streamByName,
    streamNameGuard,
    classesByKey,
  });
  if (materialized.error) {
    return NextResponse.json({ error: materialized.error }, { status: 500 });
  }

  // Stub students for the leavers, then re-read so every admission_no in this
  // file maps to an id — including any created by a concurrent run.
  if (toCreate.size > 0) {
    const created = await createStubStudents(admin, {
      toCreate: [...toCreate.values()],
      academicYearId,
      batchId,
      actorId: user.id,
      classesByKey,
      streamByName,
    });
    if (created.error) return NextResponse.json({ error: created.error }, { status: 500 });
    for (const [adm, lite] of created.byAdmissionNo) studentsByAdm.set(adm, lite);
    warnings.push(...created.warnings);
  }

  for (const r of resolved) {
    if (r.student_id) continue;
    const s = studentsByAdm.get(r.admission_no);
    if (!s) {
      return NextResponse.json(
        { error: `Student ${r.admission_no} could not be created or found after insert.` },
        { status: 500 }
      );
    }
    r.student_id = s.id;
  }

  // ── Turn the allocation into rows ────────────────────────────────────────
  // The allocation itself already ran, before the dry-run branch, so a preview
  // that reported clean is the same computation being written here.
  const srcBySourceRow = new Map(resolved.map((r) => [r.src.source_row, r.src]));
  const studentBySourceRow = new Map(
    resolved.map((r) => [r.src.source_row, r.student_id!])
  );

  const payload: Array<Record<string, unknown>> = [];
  for (const slice of allocation.slices) {
    const src = srcBySourceRow.get(slice.source_row);
    const studentId = studentBySourceRow.get(slice.source_row);
    if (!src || !studentId) continue;
    payload.push(
      buildPaymentRow({
        studentId,
        academicYearId,
        yearPrefix,
        slice,
        src,
        recordedBy: user.id,
        batchId,
      })
    );
  }

  // ── Insert ───────────────────────────────────────────────────────────────
  let committed = 0;
  let skippedConflicts = 0;
  const insertErrors: string[] = [];
  for (let i = 0; i < payload.length; i += INSERT_CHUNK) {
    const chunk = payload.slice(i, i + INSERT_CHUNK);
    const { data, error } = await admin
      .from("fee_payments")
      .upsert(chunk, { onConflict: "receipt_number", ignoreDuplicates: true })
      .select("id");
    if (error) {
      insertErrors.push(error.message);
      continue;
    }
    const n = (data ?? []).length;
    committed += n;
    skippedConflicts += chunk.length - n;
  }

  if (insertErrors.length > 0 && committed === 0) {
    return NextResponse.json(
      { error: "Insert failed", details: insertErrors.slice(0, 5).join("; ") },
      { status: 500 }
    );
  }

  const amountTotal = payload.reduce((s, p) => s + Number(p.amount_paid ?? 0), 0);
  const { error: batchErr } = await admin.from("import_batches").insert({
    id: batchId,
    kind: "fees_day_book",
    academic_year_id: academicYearId,
    file_name: file.name,
    file_size_bytes: file.size,
    source_period_start: parsed.period_start,
    source_period_end: parsed.period_end,
    row_count: parsed.receipts.length,
    created_count: committed,
    skipped_count: counts.already_imported + counts.skip_zero + skippedConflicts,
    amount_total: amountTotal,
    control_totals: {
      file: parsed.control,
      imported: reconciliation?.imported ?? null,
      students_created: toCreate.size,
    },
    created_by: user.id,
  });
  // The receipts are in and correct; a missing registry row costs the revert
  // button, not the money. Surface it instead of failing the whole import.
  if (batchErr) {
    warnings.push(
      `Payments were imported, but the batch could not be registered ` +
        `(${batchErr.message}). Batch id: ${batchId} — keep it for a revert.`
    );
  }

  return NextResponse.json({
    summary: {
      ...counts,
      total_rows: parsed.receipts.length,
      heads: parsed.heads,
      payments_created: committed,
      skipped_conflicts: skippedConflicts,
      students_created: toCreate.size,
      amount_total: amountTotal,
      dry_run: false,
      committed: true,
      blocked: false,
      batch_id: batchId,
    },
    rows: rowResults,
    unmapped_classes: [],
    unmapped_heads: [],
    students_to_create: [...toCreate.values()],
    reconciliation,
    warnings: [...warnings, ...insertErrors],
  });
}

// ───────────────────────── helpers ─────────────────────────

function parseJsonField<T>(raw: FormDataEntryValue | null): T | undefined {
  if (typeof raw !== "string" || !raw.trim()) return {} as T;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return undefined;
    return parsed as T;
  } catch {
    return undefined;
  }
}

function classKey(name: string, section: string, streamId: string | null): string {
  return `${name.trim().toUpperCase()}::${(section ?? "").trim().toUpperCase()}::${streamId ?? ""}`;
}

/**
 * The old software prints SR numbers plainly, but a hand-edited sheet can pick
 * up a stray space or a leading zero. Compare on a normalized form so "0342"
 * and "342" are the same student — while still storing what the file said.
 */
function normalizeAdmissionNo(raw: string): string {
  const t = String(raw).trim().toUpperCase();
  return /^\d+$/.test(t) ? String(Number(t)) : t;
}

function nameLookupKey(fullName: string, fatherName: string | null): string | null {
  const a = (fullName ?? "").trim().toUpperCase().replace(/\s+/g, " ");
  const b = (fatherName ?? "").trim().toUpperCase().replace(/\s+/g, " ");
  if (!a) return null;
  return `${a}|${b}`;
}

function minDate(a: string | null, b: string): string {
  return a && a < b ? a : b;
}

function baseRow(r: ParsedDayBookReceipt): Omit<RowResult, "status"> {
  return {
    source_row: r.source_row,
    receipt_no: r.receipt_no,
    payment_date: r.payment_date,
    admission_no: r.admission_no,
    student_name: r.student_name,
    raw_class: r.raw_class,
    raw_section: r.raw_section,
    payment_method: r.payment_method,
    total: r.total,
  };
}

function tally(rows: RowResult[]) {
  const c: Record<RowStatus, number> = {
    ok: 0,
    error: 0,
    skip_zero: 0,
    already_imported: 0,
    conflict: 0,
    needs_review: 0,
  };
  for (const r of rows) c[r.status] += 1;
  return c;
}

function emptySummary() {
  return {
    ok: 0,
    error: 0,
    skip_zero: 0,
    already_imported: 0,
    conflict: 0,
    needs_review: 0,
    total_rows: 0,
    dry_run: true,
    committed: false,
    blocked: false,
  };
}

/**
 * Three-way reconciliation: what the file's own footer claims, what the parse
 * actually read, and what this run would write. The office signs off on the
 * import against this, so it is computed even on a dry run.
 */
function buildReconciliation(
  parsed: ReturnType<typeof parseHeadWiseDayBook>,
  rows: RowResult[]
) {
  const parsedByMode: Record<string, number> = {};
  for (const r of parsed.receipts) {
    parsedByMode[r.payment_method] = (parsedByMode[r.payment_method] ?? 0) + r.total;
  }
  const importable = rows.filter((r) => r.status === "ok");
  const importedByMode: Record<string, number> = {};
  for (const r of importable) {
    importedByMode[r.payment_method] = (importedByMode[r.payment_method] ?? 0) + r.total;
  }
  const sum = (o: Record<string, number>) => Object.values(o).reduce((a, b) => a + b, 0);

  const excluded: Record<string, number> = {};
  for (const r of rows) {
    if (r.status === "ok") continue;
    excluded[r.status] = (excluded[r.status] ?? 0) + r.total;
  }

  return {
    file: { by_mode: parsed.control.by_mode, by_head: parsed.control.by_head, grand: parsed.control.grand },
    parsed: { by_mode: parsedByMode, grand: sum(parsedByMode), rows: parsed.receipts.length },
    imported: { by_mode: importedByMode, grand: sum(importedByMode), rows: importable.length },
    excluded,
    /** True when the parse read exactly what the file's footer claims. */
    parse_matches_file:
      parsed.control.grand !== null &&
      Math.round((sum(parsedByMode) - parsed.control.grand) * 100) === 0,
  };
}

type AdminClient = NonNullable<
  Awaited<ReturnType<typeof verifyAdminOrEditorWithUser>>
>["admin"];

/** Existing ledger state for the year, in three shapes the run needs. */
async function loadLedgerState(admin: AdminClient, academicYearId: string) {
  const importedByReceipt = new Map<string, { total: number; rows: number }>();
  const settledByStudentStructure = new Map<string, Map<string, number>>();
  const nativeByStudent = new Map<string, { total: number; rows: number }>();

  // PostgREST caps a page at 1000 rows; a full session runs to several
  // thousand payments, so page explicitly rather than silently truncating —
  // a short read here would re-import money that is already in the ledger.
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await admin
      .from("fee_payments")
      .select(
        "student_id, fee_structure_id, bus_stop_id, amount_paid, waiver_amount, refund_amount, status, source, source_receipt_no"
      )
      .eq("academic_year_id", academicYearId)
      // Ordered by id so the pages are disjoint: LIMIT/OFFSET without a total
      // order can hand back one row twice and skip another, which here would
      // double-count a receipt as already imported and drop a real one.
      .order("id", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) return { importedByReceipt, settledByStudentStructure, nativeByStudent, error: error.message };
    const rows = data ?? [];

    for (const p of rows) {
      const settled =
        Math.max(0, Number(p.amount_paid ?? 0) - Number(p.refund_amount ?? 0)) +
        Number(p.waiver_amount ?? 0);
      const counts = p.status === "paid" || p.status === "partial" || p.status === "refunded";

      if (p.source_receipt_no) {
        const key = String(p.source_receipt_no);
        const prev = importedByReceipt.get(key) ?? { total: 0, rows: 0 };
        importedByReceipt.set(key, {
          total: prev.total + Number(p.amount_paid ?? 0),
          rows: prev.rows + 1,
        });
      }
      if (p.source === "erp_native" && counts) {
        const prev = nativeByStudent.get(p.student_id as string) ?? { total: 0, rows: 0 };
        nativeByStudent.set(p.student_id as string, {
          total: prev.total + Number(p.amount_paid ?? 0),
          rows: prev.rows + 1,
        });
      }
      const target = (p.fee_structure_id ?? p.bus_stop_id) as string | null;
      if (target && counts) {
        const perStudent =
          settledByStudentStructure.get(p.student_id as string) ?? new Map<string, number>();
        perStudent.set(target, (perStudent.get(target) ?? 0) + Math.round(settled * 100));
        settledByStudentStructure.set(p.student_id as string, perStudent);
      }
    }

    if (rows.length < PAGE) break;
  }

  return { importedByReceipt, settledByStudentStructure, nativeByStudent, error: null as string | null };
}

async function materializeClasses(
  admin: AdminClient,
  args: {
    academicYearId: string;
    classSpecByKey: Map<string, { name: string; section: string; stream_name: string | null }>;
    streamByName: Map<string, string>;
    /** Names owned by a stream OR a wing — see the call site. (migration 118) */
    streamNameGuard: Set<string>;
    classesByKey: Map<string, { id: string; name: string; section: string; stream_id: string | null }>;
  }
): Promise<{ error: string | null }> {
  const {
    academicYearId,
    classSpecByKey,
    streamByName,
    streamNameGuard,
    classesByKey,
  } = args;

  // streamIsMissing, not a bare `has()`: "Arts" must not spawn a twin of the
  // school's "Humanities".
  const missingStreams = [
    ...new Set(
      [...classSpecByKey.values()]
        .map((s) => s.stream_name)
        .filter(
          (n): n is string =>
            streamIsMissing(streamByName, n) &&
            // …and no wing already owns the name. Creating a second row here
            // is the twin this whole guard exists to prevent. (migration 118)
            !streamNameTaken(streamNameGuard, n)
        )
    ),
  ];
  if (missingStreams.length > 0) {
    const { data, error } = await admin
      .from("streams")
      .insert(missingStreams.map((name) => ({ name, kind: "stream" })))
      .select("id, name");
    if (error) return { error: `Failed to create streams: ${error.message}` };
    for (const s of data ?? []) {
      const fresh = buildStreamLookup([{ id: s.id as string, name: String(s.name) }]);
      for (const [k, v] of fresh) if (!streamByName.has(k)) streamByName.set(k, v);
    }
  }

  const toInsert: Array<Record<string, unknown>> = [];
  for (const spec of classSpecByKey.values()) {
    const sid = resolveStreamId(streamByName, spec.stream_name);
    if (classesByKey.has(classKey(spec.name, spec.section, sid))) continue;
    toInsert.push({
      name: spec.name,
      section: spec.section,
      academic_year_id: academicYearId,
      stream_id: sid,
      // Was a flat 0, which put every imported class at the very top of the
      // 27 screens that order by this column, jumbled together.
      sort_order: classSortOrder(spec.name, spec.section),
    });
  }
  if (toInsert.length > 0) {
    const { data, error } = await admin
      .from("classes")
      .insert(toInsert)
      .select("id, name, section, stream_id");
    if (error) return { error: `Failed to create classes: ${error.message}` };
    for (const c of data ?? []) {
      classesByKey.set(classKey(c.name as string, c.section as string, c.stream_id as string | null), {
        id: c.id as string,
        name: c.name as string,
        section: c.section as string,
        stream_id: (c.stream_id as string | null) ?? null,
      });
    }
  }
  return { error: null };
}

/**
 * Create the students who paid this session but are not on the roster.
 *
 * They are inert by construction: `is_active=false` on the student, an
 * enrollment at `status='exited'`, and both tagged to the batch so a revert
 * removes them. They exist so the money has an owner, and they surface in the
 * Exited tab where the office can promote back anyone who is in fact enrolled.
 */
async function createStubStudents(
  admin: AdminClient,
  args: {
    toCreate: StudentToCreate[];
    academicYearId: string;
    batchId: string;
    actorId: string;
    classesByKey: Map<string, { id: string; name: string; section: string; stream_id: string | null }>;
    streamByName: Map<string, string>;
  }
) {
  const { toCreate, academicYearId, batchId, actorId, classesByKey, streamByName } = args;
  const warnings: string[] = [];
  const byAdmissionNo = new Map<
    string,
    { id: string; full_name: string; father_name: string | null; admission_date: string | null }
  >();

  const studentRows = toCreate.map((s) => ({
    admission_no: s.admission_no,
    full_name: s.full_name,
    father_name: s.father_name || null,
    admission_date: s.admission_date,
    is_active: false,
  }));

  const { error: insErr } = await admin
    .from("students")
    .upsert(studentRows, { onConflict: "admission_no", ignoreDuplicates: true });
  if (insErr) return { error: `Failed to create students: ${insErr.message}`, byAdmissionNo, warnings };

  // Re-read rather than trusting the insert's return: ignoreDuplicates omits
  // rows that already existed, and we need an id for every one of them.
  const { data: reread, error: readErr } = await admin
    .from("students")
    .select("id, admission_no, full_name, father_name, admission_date")
    .in(
      "admission_no",
      toCreate.map((s) => s.admission_no)
    );
  if (readErr) return { error: `Failed to read back students: ${readErr.message}`, byAdmissionNo, warnings };

  for (const s of reread ?? []) {
    byAdmissionNo.set(normalizeAdmissionNo(String(s.admission_no)), {
      id: s.id as string,
      full_name: (s.full_name as string) ?? "",
      father_name: (s.father_name as string | null) ?? null,
      admission_date: (s.admission_date as string | null) ?? null,
    });
  }

  const REASON =
    "Created by the fee day-book import — paid fees this session but is not on " +
    "the current roster. Verify and correct.";
  const now = new Date().toISOString();

  const enrollments: Array<Record<string, unknown>> = [];
  for (const s of toCreate) {
    const student = byAdmissionNo.get(normalizeAdmissionNo(s.admission_no));
    if (!student) continue;
    const sid = resolveStreamId(streamByName, s.stream_name);
    const cls = classesByKey.get(classKey(s.class_name, s.section, sid));
    if (!cls) {
      warnings.push(
        `${s.full_name} (${s.admission_no}): class ${s.class_name}-${s.section} could ` +
          `not be resolved, so no enrollment was created. Their payments are still imported.`
      );
      continue;
    }
    enrollments.push({
      student_id: student.id,
      class_id: cls.id,
      academic_year_id: academicYearId,
      stream_id: sid,
      status: "exited",
      status_reason: REASON,
      status_changed_at: now,
      status_changed_by: actorId,
      source: "historical_import",
      import_batch_id: batchId,
    });
  }

  if (enrollments.length > 0) {
    const { error } = await admin
      .from("student_enrollments")
      .upsert(enrollments, {
        onConflict: "student_id,academic_year_id",
        ignoreDuplicates: true,
      });
    if (error) {
      return { error: `Failed to create enrollments: ${error.message}`, byAdmissionNo, warnings };
    }

    const history = enrollments.map((e) => ({
      student_id: e.student_id,
      academic_year_id: academicYearId,
      class_id: e.class_id,
      from_status: null,
      to_status: "exited",
      reason: REASON,
      source: "historical_import",
      changed_by: actorId,
    }));
    const { error: histErr } = await admin.from("student_status_history").insert(history);
    // The enrollment carries the same reason on its cache columns, so a failed
    // history write loses the audit row, not the explanation.
    if (histErr) warnings.push(`Status history was not recorded: ${histErr.message}`);
  }

  return { error: null as string | null, byAdmissionNo, warnings };
}

function buildPaymentRow(args: {
  studentId: string;
  academicYearId: string;
  yearPrefix: string;
  slice: AllocationSlice;
  src: ParsedDayBookReceipt;
  recordedBy: string;
  batchId: string;
}): Record<string, unknown> {
  const { studentId, academicYearId, yearPrefix, slice, src, recordedBy, batchId } = args;
  const isCheque = src.payment_method === "cheque";

  const remarkParts = [
    `Day Book import · original receipt #${src.receipt_no}`,
    slice.instalment_name ? `${slice.head} · ${slice.instalment_name}` : slice.head,
  ];
  if (slice.over_allocated) {
    remarkParts.push("Paid beyond the published schedule for this head.");
  }
  if (src.bank_note) remarkParts.push(`Note from source: ${src.bank_note}`);

  return {
    student_id: studentId,
    fee_structure_id: slice.fee_structure_id,
    academic_year_id: academicYearId,
    amount_paid: slice.amount,
    payment_method: src.payment_method,
    payment_date: src.payment_date,
    month: slice.month_label ?? null,
    receipt_number: buildImportReceiptNumber(yearPrefix, src.receipt_no, slice.slice_no),
    source_receipt_no: src.receipt_no,
    status: slice.partial ? "partial" : "paid",
    recorded_by: recordedBy,
    // The old software puts the cheque number and the online transaction
    // reference in the same column; only the mode says which it is.
    cheque_number: isCheque ? src.instrument_ref : null,
    cheque_date: src.instrument_date,
    bank_name: src.bank_name,
    payer_name: src.father_name || null,
    transaction_ref: isCheque ? null : src.instrument_ref,
    remarks: remarkParts.join(". "),
    source: "historical_import",
    import_batch_id: batchId,
  };
}


/**
 * Group the resolved receipts per student and run the waterfall for each.
 *
 * Grouped on `student_id ?? "new:" + admission_no` rather than on the student
 * id alone, because this runs BEFORE the stub students are created — that
 * ordering is deliberate, so a dry run reports exactly what a commit would
 * write instead of discovering an unallocatable head only at commit time.
 */
function allocate(args: {
  resolved: Array<{
    src: ParsedDayBookReceipt;
    student_id: string | null;
    admission_no: string;
    norm: NormalizedClass;
    section: string;
  }>;
  structures: FeeStructure[];
  streamByName: Map<string, string>;
  studentsByAdm: Map<string, { admission_date: string | null }>;
  toCreate: Map<string, StudentToCreate>;
  headResolution: Map<string, string>;
  settledByStudentStructure: Map<string, Map<string, number>>;
  year: { start_date: string; end_date: string };
}): {
  slices: AllocationSlice[];
  problems: Array<{ source_row: number; message: string }>;
  perRow: Map<number, { slices: number; over_allocated: boolean }>;
} {
  const {
    resolved,
    structures,
    streamByName,
    studentsByAdm,
    toCreate,
    headResolution,
    settledByStudentStructure,
    year,
  } = args;

  const groups = new Map<string, typeof resolved>();
  for (const r of resolved) {
    const key = r.student_id ?? `new:${r.admission_no}`;
    groups.set(key, [...(groups.get(key) ?? []), r]);
  }

  const slices: AllocationSlice[] = [];
  const problems: Array<{ source_row: number; message: string }> = [];
  const perRow = new Map<number, { slices: number; over_allocated: boolean }>();

  // One schedule pair per (class, stream, studentType) — a class of 40 shares
  // the same three resolutions, and resolveEffectiveFeeStructures is not free.
  const scheduleCache = new Map<
    string,
    {
      scheduleByHead: Map<string, AllocatableStructure[]>;
      fallbackByHead: Map<string, AllocatableStructure[]>;
    }
  >();

  for (const [, rows] of groups) {
    const first = rows[0];
    const streamId = resolveStreamId(streamByName, first.norm.stream_name);

    const admissionDate =
      studentsByAdm.get(first.admission_no)?.admission_date ??
      toCreate.get(first.admission_no)?.admission_date ??
      null;
    const studentType = resolveStudentType(admissionDate, year);

    const cacheKey = `${first.norm.class_name}::${streamId ?? ""}::${studentType ?? ""}`;
    let cached = scheduleCache.get(cacheKey);
    if (!cached) {
      const classStructures = structures.filter(
        (fs) => fs.class_name === first.norm.class_name
      );
      cached = {
        scheduleByHead: groupScheduleByHead(
          resolveEffectiveFeeStructures(classStructures, {
            studentStreamId: streamId,
            studentType,
          }) as AllocatableStructure[]
        ),
        fallbackByHead: groupScheduleByHead(
          resolveEffectiveFeeStructures(classStructures, {
            studentStreamId: streamId,
            ignoreStudentType: true,
          }) as AllocatableStructure[]
        ),
      };
      scheduleCache.set(cacheKey, cached);
    }

    const result = allocateStudentReceipts({
      receipts: rows.map((r) => ({
        receipt_no: r.src.receipt_no,
        source_row: r.src.source_row,
        payment_date: r.src.payment_date!,
        heads: r.src.heads.map((h) => ({
          head: headResolution.get(h.head) ?? h.head,
          amount: h.amount,
        })),
      })),
      scheduleByHead: cached.scheduleByHead,
      fallbackByHead: cached.fallbackByHead,
      // A student who does not exist yet has no ledger to stack on.
      alreadyFilledPaise: first.student_id
        ? settledByStudentStructure.get(first.student_id)
        : undefined,
    });

    for (const p of result.problems) {
      problems.push({ source_row: p.source_row, message: p.message });
    }
    // A receipt with any unallocatable head is dropped whole rather than
    // half-written: importing part of a receipt would make its total wrong in
    // the ledger while the row still reads as imported.
    const badRows = new Set(result.problems.map((p) => p.source_row));
    for (const slice of result.slices) {
      if (badRows.has(slice.source_row)) continue;
      slices.push(slice);
      const prev = perRow.get(slice.source_row) ?? { slices: 0, over_allocated: false };
      perRow.set(slice.source_row, {
        slices: prev.slices + 1,
        over_allocated: prev.over_allocated || slice.over_allocated,
      });
    }
  }

  return { slices, problems, perRow };
}
