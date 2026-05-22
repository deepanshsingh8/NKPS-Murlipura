// POST /api/results/historical-import
//
// Bulk-imports historical exam results from the previous ERP software's
// "Result GreenSheet" XLSX. Mirrors the fees historical importer.
//
// Two-phase: dry_run="true" returns preview + unmapped_classes; dry_run="false"
// with class_mappings JSON commits.
//
// On commit:
//   • Auto-creates `subjects` rows for any subject name not yet present
//   • Auto-creates `exam_types` rows for the year:
//       "Half Yearly (Imported {year-name})"
//       "Annual (Imported {year-name})"
//   • Upserts into `results` with onConflict on (student_id, subject_id,
//     exam_type_id) so re-imports overwrite rather than duplicate.

import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { verifyAdminOrEditorWithUser } from "@nkps/shared/lib/verify-admin";
import {
  parseGreensheetResults,
  normalizeClassNameWithOverrides,
  type NormalizedClass,
  type ParsedResultsRow,
} from "@nkps/shared/lib/historical-import";

const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

interface RowResult {
  source_row: number;
  raw_class: string;
  raw_section: string;
  admission_no: string;
  student_name: string;
  marks_count: number;
  ok: boolean;
  error?: string;
  resolved_student_id?: string;
  resolved_class_id?: string;
}

export async function POST(req: NextRequest) {
  const auth = await verifyAdminOrEditorWithUser("results");
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

  const { data: yearRow } = await admin
    .from("academic_years")
    .select("id, name")
    .eq("id", academicYearId)
    .maybeSingle();
  if (!yearRow) {
    return NextResponse.json(
      { error: "academic_year_id not found" },
      { status: 400 }
    );
  }
  const academicYearName = yearRow.name as string;

  // Parse XLSX.
  let parsed: ReturnType<typeof parseGreensheetResults>;
  try {
    const buf = await file.arrayBuffer();
    parsed = parseGreensheetResults(buf);
  } catch (err) {
    return NextResponse.json(
      {
        error: "Failed to parse XLSX",
        details: err instanceof Error ? err.message : String(err),
      },
      { status: 400 }
    );
  }
  if (parsed.rows.length === 0) {
    return NextResponse.json({
      summary: emptySummary(true),
      rows: [],
      unmapped_classes: [],
      warnings: parsed.warnings,
    });
  }

  // Resolve class names.
  const classResolution = new Map<string, NormalizedClass | null>();
  const unmappedClasses = new Set<string>();
  for (const r of parsed.rows) {
    if (classResolution.has(r.raw_class)) continue;
    const norm = normalizeClassNameWithOverrides(r.raw_class, classMappings);
    classResolution.set(r.raw_class, norm);
    if (!norm) unmappedClasses.add(r.raw_class);
  }

  // Load lookups.
  const [streamsRes, classesRes, studentsRes, subjectsRes, examTypesRes] =
    await Promise.all([
      admin.from("streams").select("id, name"),
      admin
        .from("classes")
        .select("id, name, section, stream_id")
        .eq("academic_year_id", academicYearId),
      admin.from("students").select("id, admission_no"),
      admin.from("subjects").select("id, name"),
      admin
        .from("exam_types")
        .select("id, name, max_marks")
        .eq("academic_year_id", academicYearId),
    ]);
  for (const r of [streamsRes, classesRes, studentsRes, subjectsRes, examTypesRes]) {
    if (r.error) {
      return NextResponse.json({ error: r.error.message }, { status: 500 });
    }
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
  const studentsByAdm = new Map<string, string>();
  for (const s of studentsRes.data ?? []) {
    if (s.admission_no) studentsByAdm.set(String(s.admission_no), s.id as string);
  }
  const subjectsByKey = new Map<string, string>();
  for (const s of subjectsRes.data ?? []) {
    subjectsByKey.set(normSubject(s.name as string), s.id as string);
  }
  const examTypesByName = new Map<string, { id: string; max_marks: number }>();
  for (const e of examTypesRes.data ?? []) {
    examTypesByName.set(String(e.name).trim(), {
      id: e.id as string,
      max_marks: Number(e.max_marks),
    });
  }

  // Per-row resolution. Classes (and streams if needed) are auto-created
  // during commit — they're deterministic from the source data. Rows track
  // the spec; class_id is materialized later.
  const rowResults: RowResult[] = [];
  type ClassSpec = { name: string; section: string; stream_name: string | null };
  const classSpecByKey = new Map<string, ClassSpec>();
  const resolvedRows: Array<{
    src: ParsedResultsRow;
    student_id: string;
    class_spec_key: string;
  }> = [];

  for (const r of parsed.rows) {
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

    const studentId = studentsByAdm.get(r.admission_no);
    if (!studentId) {
      rowResults.push(
        rowError(r, `Student not found in ERP for admission_no=${r.admission_no}.`)
      );
      continue;
    }

    if (r.marks.length === 0) {
      rowResults.push(rowError(r, "Row has no marks to import."));
      continue;
    }

    rowResults.push({
      source_row: r.source_row,
      raw_class: r.raw_class,
      raw_section: r.raw_section,
      admission_no: r.admission_no,
      student_name: r.student_name,
      marks_count: r.marks.length,
      ok: true,
      resolved_student_id: studentId,
    });
    resolvedRows.push({ src: r, student_id: studentId, class_spec_key: sKey });
  }

  const errorRows = rowResults.filter((r) => !r.ok);
  const okRows = rowResults.filter((r) => r.ok);
  const marksToCreate = resolvedRows.reduce((a, r) => a + r.src.marks.length, 0);

  // Informational: count entities that will be auto-created on commit.
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
    const missing =
      (spec.stream_name && !sid) ||
      !classesByKey.has(classKey(spec.name, spec.section, sid));
    if (missing) {
      willCreateClasses.push({
        name: spec.name,
        section: spec.section,
        stream_name: spec.stream_name,
      });
    }
  }

  if (dryRun || errorRows.length > 0 || unmappedClasses.size > 0) {
    return NextResponse.json({
      summary: {
        total_rows: parsed.rows.length,
        ok_rows: okRows.length,
        error_rows: errorRows.length,
        results_to_create: marksToCreate,
        will_create_streams: willCreateStreams,
        will_create_classes: willCreateClasses,
        dry_run: true,
        committed: false,
        unmapped_classes: [...unmappedClasses],
      },
      rows: rowResults,
      unmapped_classes: [...unmappedClasses],
      subjects_in_file: parsed.subjects,
      warnings: parsed.warnings,
    });
  }

  // --- COMMIT PATH -----------------------------------------------------
  const batchId = randomUUID();

  // 0a. Materialize any missing streams.
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

  // 1. Ensure subjects exist for everything in this file.
  const distinctSubjects = new Set<string>();
  for (const r of resolvedRows) {
    for (const m of r.src.marks) distinctSubjects.add(m.subject);
  }
  const missingSubjects = [...distinctSubjects].filter(
    (s) => !subjectsByKey.has(normSubject(s))
  );
  if (missingSubjects.length > 0) {
    const { data: inserted, error: insErr } = await admin
      .from("subjects")
      .insert(missingSubjects.map((name) => ({ name, is_active: true })))
      .select("id, name");
    if (insErr) {
      return NextResponse.json(
        { error: `Failed to create subjects: ${insErr.message}` },
        { status: 500 }
      );
    }
    for (const s of inserted ?? []) {
      subjectsByKey.set(normSubject(s.name as string), s.id as string);
    }
  }

  // 2. Ensure exam_types "Half Yearly (Imported …)" and "Annual (Imported …)"
  //    exist for this academic year.
  const halfName = `Half Yearly (Imported ${academicYearName})`;
  const annualName = `Annual (Imported ${academicYearName})`;
  for (const name of [halfName, annualName]) {
    if (examTypesByName.has(name)) continue;
    const { data: inserted, error: insErr } = await admin
      .from("exam_types")
      .insert({
        name,
        academic_year_id: academicYearId,
        max_marks: 100,
        kind: "term_exam",
      })
      .select("id, max_marks")
      .single();
    if (insErr || !inserted) {
      return NextResponse.json(
        { error: `Failed to create exam_type "${name}": ${insErr?.message ?? "no data"}` },
        { status: 500 }
      );
    }
    examTypesByName.set(name, {
      id: inserted.id as string,
      max_marks: Number(inserted.max_marks),
    });
  }
  const halfExam = examTypesByName.get(halfName)!;
  const annualExam = examTypesByName.get(annualName)!;

  // 3. Flatten marks into results payload.
  const resultsPayload: Array<Record<string, unknown>> = [];
  for (const r of resolvedRows) {
    const classId = classIdBySpec.get(r.class_spec_key);
    if (!classId) continue; // defensive — should always resolve after step 0c
    for (const m of r.src.marks) {
      const subjectId = subjectsByKey.get(normSubject(m.subject));
      if (!subjectId) continue; // defensive
      const exam = m.exam === "Half Yearly" ? halfExam : annualExam;
      resultsPayload.push({
        student_id: r.student_id,
        class_id: classId,
        subject_id: subjectId,
        exam_type_id: exam.id,
        marks_obtained: m.obtained,
        max_marks: m.max_marks,
        remarks: m.has_distinction
          ? `Imported. Marked 'D' (Distinction) in source.`
          : "Imported from previous ERP software.",
        entered_by: user.id,
        is_published: true,
        source: "historical_import",
        import_batch_id: batchId,
      });
    }
  }

  // 4. Bulk upsert in chunks.
  let committed = 0;
  const insertErrors: string[] = [];
  for (let i = 0; i < resultsPayload.length; i += 500) {
    const chunk = resultsPayload.slice(i, i + 500);
    const { data: inserted, error: chunkErr } = await admin
      .from("results")
      .upsert(chunk, {
        onConflict: "student_id,subject_id,exam_type_id",
      })
      .select("id");
    if (chunkErr) {
      insertErrors.push(chunkErr.message);
      continue;
    }
    committed += (inserted ?? []).length;
  }
  if (insertErrors.length > 0 && committed === 0) {
    return NextResponse.json(
      { error: "Insert failed", details: insertErrors.slice(0, 5).join("; ") },
      { status: 500 }
    );
  }

  return NextResponse.json({
    summary: {
      total_rows: parsed.rows.length,
      ok_rows: okRows.length,
      error_rows: errorRows.length,
      results_to_create: resultsPayload.length,
      committed,
      dry_run: false,
      batch_id: batchId,
      unmapped_classes: [],
    },
    rows: rowResults,
    subjects_in_file: parsed.subjects,
    warnings: [...parsed.warnings, ...insertErrors],
  });
}

// ----- helpers -------------------------------------------------------

function classKey(name: string, section: string, streamId: string | null): string {
  return `${name.trim().toUpperCase()}::${(section ?? "").trim().toUpperCase()}::${streamId ?? ""}`;
}

function normSubject(s: string): string {
  return s.trim().toUpperCase().replace(/[.\s]+/g, "");
}

function rowError(r: ParsedResultsRow, msg: string): RowResult {
  return {
    source_row: r.source_row,
    raw_class: r.raw_class,
    raw_section: r.raw_section,
    admission_no: r.admission_no,
    student_name: r.student_name,
    marks_count: r.marks.length,
    ok: false,
    error: msg,
  };
}

function emptySummary(dryRun: boolean) {
  return {
    total_rows: 0,
    ok_rows: 0,
    error_rows: 0,
    results_to_create: 0,
    dry_run: dryRun,
    committed: false,
    unmapped_classes: [] as string[],
  };
}
