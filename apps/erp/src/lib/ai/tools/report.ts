import { z } from "zod";
import { runStudentReport, toMatrix, ReportQueryError } from "@/lib/report-query";
import type { ReportField } from "@nkps/shared/lib/report-fields";
import {
  applyScope,
  enforceScopeOnRows,
  type CallerContext,
  type ScopedFilters,
} from "../caller-context";
import { resolveAiFields, describeWithheld } from "../field-policy";
import { recordToolCall, createQueryRun } from "../audit";
import { toolError, type ToolError } from "../tool-errors";

/**
 * The one tool that reaches the student corpus.
 *
 * ── One wide tool, not several narrow ones ──────────────────────────────────
 * `reportFiltersSchema` IS the contract the report screen already runs on. A
 * decomposed surface (find_students_by_fee_status, …) would need a mapping
 * table that drifts the moment someone adds filter #31 — and drifts silently,
 * because the symptom is the assistant quietly losing the ability to express a
 * filter the UI still has. One tool also means one applyScope call site rather
 * than N, which is the difference between a reviewable security boundary and a
 * scattered one.
 *
 * ── Why `strict: true` is NOT set on this tool ──────────────────────────────
 * strict requires additionalProperties:false plus every key in `required`, and
 * ~30 of these keys carry zod defaults. Forcing the model to emit all of them
 * costs tokens on every call and makes output *worse*: it starts inventing
 * values for slots it does not care about (gender:"male" because the field
 * exists). Instead the schema is permissive here and the server runs the real
 * `reportFiltersSchema.parse()`, which fills defaults and produces a zod error
 * the model can act on. The small lookup tools DO use strict, where every
 * field is genuinely required.
 */

/** Rows handed to the model. Never the full result set — see the header. */
const MAX_PREVIEW_ROWS = 25;
const DEFAULT_PREVIEW_ROWS = 10;
/** Hard ceiling on the serialised tool_result, before rows get dropped. */
const MAX_RESULT_BYTES = 8_000;
/** Longest single cell handed to the model. */
const MAX_CELL_CHARS = 80;

/**
 * Model-facing filter shape.
 *
 * Deliberately loose: this is a hint for the model, not the validator. The
 * authoritative parse is `reportFiltersSchema` inside applyScope. Note there
 * is no `student_ids` key and there never will be — a scope-shaped field
 * inside the model-writable object would defeat the entire design.
 */
const modelFiltersSchema = z
  .object({
    session_id: z.string().optional(),
    class_ids: z.array(z.string()).optional(),
    section: z.string().optional(),
    stream_id: z.string().optional(),
    subject_id: z.string().optional(),
    house_id: z.string().optional(),
    name_contains: z.string().optional(),
    father_name_contains: z.string().optional(),
    admission_date_from: z.string().optional(),
    admission_date_to: z.string().optional(),
    dob_from: z.string().optional(),
    dob_to: z.string().optional(),
    gender: z.string().optional(),
    category: z.string().optional(),
    religion: z.string().optional(),
    minority_group: z.string().optional(),
    area_type: z.string().optional(),
    is_rte: z.enum(["both", "yes", "no"]).optional(),
    is_bpl: z.enum(["both", "yes", "no"]).optional(),
    is_ews: z.enum(["both", "yes", "no"]).optional(),
    is_cwsn: z.enum(["both", "yes", "no"]).optional(),
    is_staff_ward: z.enum(["both", "yes", "no"]).optional(),
    has_transport: z.enum(["both", "yes", "no"]).optional(),
    statuses: z
      .array(z.enum(["active", "passed", "failed", "terminated", "exited"]))
      .optional(),
    new_old: z.enum(["both", "new", "old"]).optional(),
    fee_status: z.enum(["all", "due", "clear"]).optional(),
    attendance_below: z.number().optional(),
    fields: z.array(z.string()).optional(),
    sort_by: z.string().optional(),
    sort_dir: z.enum(["asc", "desc"]).optional(),
    then_by: z.string().optional(),
    then_dir: z.enum(["asc", "desc"]).optional(),
  })
  .passthrough();

export const runStudentReportInput = z.object({
  filters: modelFiltersSchema,
  preview_rows: z.number().int().min(0).max(MAX_PREVIEW_ROWS).optional(),
  /**
   * Server-side rollups. The escape hatch that lets "how many per class" be
   * answered with zero rows in context.
   */
  group_by: z.array(z.string().max(64)).max(2).optional(),
  /** Logged verbatim. Naming the intent measurably improves filter quality. */
  purpose: z.string().min(4).max(200),
});

export type RunStudentReportInput = z.infer<typeof runStudentReportInput>;

export interface RunStudentReportResult {
  run_id: string | null;
  total: number;
  capped: boolean;
  columns: { key: string; label: string }[];
  preview: Record<string, string | number | null>[];
  preview_truncated: boolean;
  group_counts?: { by: string; counts: { value: string; n: number }[] }[];
  scope_applied: string;
  unknown_fields: { key: string; did_you_mean: string[] }[];
  withheld_fields: { key: string; reason: string }[];
  withheld_notice: string | null;
  notes: string[];
}

/**
 * The only place allowed to run a report on the AI path.
 *
 * Typed to require ScopedFilters, which only applyScope can mint. Deleting the
 * scoping step is therefore a compile error rather than a data leak — that is
 * the whole reason the brand exists.
 */
async function runScoped(
  ctx: CallerContext,
  filters: ScopedFilters,
  fields: Parameters<typeof runStudentReport>[2]
) {
  return runStudentReport(ctx.admin, filters, fields);
}

export async function executeRunStudentReport(
  ctx: CallerContext,
  rawInput: unknown,
  messageSeq: number | null
): Promise<{ ok: true; result: RunStudentReportResult } | { ok: false; error: ToolError }> {
  const started = Date.now();

  const parsedInput = runStudentReportInput.safeParse(rawInput);
  if (!parsedInput.success) {
    const err = toolError(
      "invalid_filters",
      "The tool arguments were malformed.",
      parsedInput.error.flatten()
    );
    await recordToolCall({
      admin: ctx.admin,
      conversationId: ctx.conversationId,
      messageSeq,
      toolName: "run_student_report",
      argsRaw: rawInput,
      errorCode: err.code,
      durationMs: Date.now() - started,
    });
    return { ok: false, error: err };
  }

  const input = parsedInput.data;

  // Scope BEFORE anything touches the database.
  const scoped = applyScope(ctx, input.filters);
  if (!scoped.ok) {
    const err = toolError(scoped.error.code, scoped.error.message, scoped.error.detail);
    await recordToolCall({
      admin: ctx.admin,
      conversationId: ctx.conversationId,
      messageSeq,
      toolName: "run_student_report",
      argsRaw: input,
      errorCode: err.code,
      durationMs: Date.now() - started,
    });
    return { ok: false, error: err };
  }

  const requestedKeys = input.filters.fields ?? scoped.filters.fields ?? [];
  const policy = resolveAiFields(ctx, requestedKeys);

  // ── Columns the model wants to GROUP by have to be fetched too ────────────
  //
  // This is not an optimisation, it is a correctness bug that hides in plain
  // sight. `runStudentReport` projects only the columns the fields it is
  // handed declare, and every `resolve()` reads straight off the row — so a
  // group_by field missing from the projection does not error. It reads
  // `undefined` and falls out of the field's else branch, producing a rollup
  // that is uniform, plausible and wrong.
  //
  // Observed: grouping 942 students by `has_transport` returned "NO" for all
  // 942, while the same query's `has_transport: "yes"` filter correctly
  // matched 744. The filter runs in Postgres; the rollup ran on a row that
  // never carried the column.
  //
  // Resolved through resolveAiFields, not waved through: a rollup over
  // `father_mobile` enumerates parent numbers just as effectively as a column
  // of them would, so grouping obeys the same sensitivity gate as output.
  const groupKeys = input.group_by ?? [];
  const groupPolicy =
    groupKeys.length > 0 ? resolveAiFields(ctx, groupKeys) : null;

  // The query projects the union. The OUTPUT stays exactly the columns that
  // were asked for — grouping by transport must not add a transport column to
  // the table or the CSV.
  const queryFields = groupPolicy
    ? unionFields(policy.fields, groupPolicy.fields)
    : policy.fields;

  // Only fatal when NOTHING resolved. A partial answer with a named gap beats
  // a round-trip; the model is told what it got wrong either way.
  if (policy.fields.length === 0 && policy.unknown.length > 0) {
    const err = toolError(
      "unknown_fields",
      "None of those column names exist.",
      { unknown: policy.unknown }
    );
    await recordToolCall({
      admin: ctx.admin,
      conversationId: ctx.conversationId,
      messageSeq,
      toolName: "run_student_report",
      argsRaw: input,
      argsScoped: scoped.filters,
      errorCode: err.code,
      durationMs: Date.now() - started,
    });
    return { ok: false, error: err };
  }

  let queryResult;
  try {
    queryResult = await runScoped(ctx, scoped.filters, queryFields);
  } catch (err) {
    const code = err instanceof ReportQueryError ? "query_failed" : "query_failed";
    const message =
      err instanceof ReportQueryError
        ? err.message
        : "The report could not be run.";
    await recordToolCall({
      admin: ctx.admin,
      conversationId: ctx.conversationId,
      messageSeq,
      toolName: "run_student_report",
      argsRaw: input,
      argsScoped: scoped.filters,
      errorCode: code,
      durationMs: Date.now() - started,
    });
    return { ok: false, error: toolError("query_failed", message) };
  }

  // Defence in depth. applyScope already narrowed the query, so a non-zero
  // drop here means the query builder changed under us — that is an incident,
  // not a filter, so it is logged loudly.
  const guarded = enforceScopeOnRows(ctx, queryResult.rows);
  if (guarded.dropped > 0) {
    console.error(
      `[ai.report] enforceScopeOnRows dropped ${guarded.dropped} row(s) that applyScope should already have excluded — check report-query.ts`
    );
  }

  const notes: string[] = [];
  const capped = queryResult.total >= 19_999;
  if (capped) {
    notes.push(
      "The result hit the engine's 19,999-row ceiling. Tell the user the list is truncated."
    );
  }
  if (queryResult.total === 0) {
    notes.push("0 rows matched.");
    notes.push(...zeroRowDiagnostics(scoped.filters));
  }

  const { headers, body } = toMatrix(guarded.rows, policy.fields);
  const previewCount = Math.min(
    input.preview_rows ?? DEFAULT_PREVIEW_ROWS,
    MAX_PREVIEW_ROWS
  );

  let preview = body.slice(0, previewCount).map((row) => {
    const obj: Record<string, string | number | null> = {};
    policy.fields.forEach((field, i) => {
      const value = row[i];
      obj[field.key] =
        typeof value === "string" && value.length > MAX_CELL_CHARS
          ? `${value.slice(0, MAX_CELL_CHARS)}…`
          : value;
    });
    return obj;
  });

  // Drop rows until the payload fits. Aggregates, not rows, are the intended
  // way to answer questions about large result sets.
  let previewTruncated = false;
  while (preview.length > 0 && JSON.stringify(preview).length > MAX_RESULT_BYTES) {
    preview = preview.slice(0, preview.length - 1);
    previewTruncated = true;
  }

  const groupCounts = groupPolicy
    ? computeGroupCounts(groupKeys, guarded.rows, groupPolicy.fields)
    : [];

  // A group_by key that was unknown or withheld yields no rollup. Fold it into
  // the same two lists the model is already required to read out, or it simply
  // never learns why the breakdown it asked for is missing.
  const unknownFields = mergeUnknown(policy.unknown, groupPolicy?.unknown ?? []);
  const withheldFields = mergeWithheld(policy.withheld, groupPolicy?.withheld ?? []);

  const runId = await createQueryRun({
    ctx,
    filters: scoped.filters,
    fieldKeys: policy.fields.map((f) => f.key),
    total: queryResult.total,
    capped,
    academicYearId: queryResult.session?.id ?? null,
    // Both of these exist only so a REOPENED chat can rebuild itself: the seq
    // says which answer owns this result, and the purpose is the chip's label.
    // Neither is reachable afterwards from anywhere else — args_raw holds the
    // purpose, but two parallel report calls in one round share a message_seq
    // and nothing links a tool-call row to the run it produced.
    messageSeq,
    purpose: input.purpose,
  });

  await recordToolCall({
    admin: ctx.admin,
    conversationId: ctx.conversationId,
    messageSeq,
    toolName: "run_student_report",
    argsRaw: input,
    argsScoped: scoped.filters,
    scopeApplied: { kind: ctx.scope.kind, note: scoped.scopeNote },
    rowCount: queryResult.total,
    previewRowCount: preview.length,
    fieldKeys: queryFields.map((f) => f.key),
    sensitiveIncluded:
      policy.sensitiveIncluded || (groupPolicy?.sensitiveIncluded ?? false),
    durationMs: Date.now() - started,
  });

  return {
    ok: true,
    result: {
      run_id: runId,
      total: queryResult.total,
      capped,
      columns: policy.fields.map((f, i) => ({ key: f.key, label: headers[i] })),
      preview,
      preview_truncated: previewTruncated,
      group_counts: groupCounts.length > 0 ? groupCounts : undefined,
      scope_applied: scoped.scopeNote,
      unknown_fields: unknownFields.map((u) => ({
        key: u.key,
        did_you_mean: u.didYouMean,
      })),
      withheld_fields: withheldFields.map((w) => ({ key: w.key, reason: w.reason })),
      withheld_notice: describeWithheld(withheldFields),
      notes,
    },
  };
}

/**
 * Why zero rows is not an answer.
 *
 * The free-text demographic filters are untyped strings, so a plausible-but-
 * wrong value ("General" where the data says "GEN") returns an empty list that
 * reads exactly like a true negative. Naming the filters that could have
 * caused it lets the model check rather than assert.
 */
function zeroRowDiagnostics(filters: Record<string, unknown>): string[] {
  const freeText = [
    "gender",
    "category",
    "religion",
    "minority_group",
    "area_type",
    "section",
  ];
  const notes: string[] = [];
  for (const key of freeText) {
    const value = filters[key];
    if (typeof value === "string" && value.trim()) {
      notes.push(
        `${key}="${value}" is matched exactly. Call list_lookup_values to see the values actually present before concluding there are none.`
      );
    }
  }
  if (filters.attendance_below != null && filters.attendance_below !== "") {
    notes.push(
      "attendance_below excludes students with no attendance marked at all, not just those above the threshold."
    );
  }
  return notes;
}

/**
 * Cheap in-memory rollups over the already-fetched rows.
 *
 * `available` is the set of fields the query actually PROJECTED, not the whole
 * catalogue. That is the point: resolving a field whose columns were never
 * selected silently yields the field's fallback value for every row, so a key
 * that is not in this list must produce no rollup at all rather than a
 * confident wrong one. Callers report those keys as unknown or withheld.
 */
function computeGroupCounts(
  groupBy: readonly string[],
  rows: readonly unknown[],
  available: readonly ReportField[]
): { by: string; counts: { value: string; n: number }[] }[] {
  const byKey = new Map(available.map((f) => [f.key, f]));
  const out: { by: string; counts: { value: string; n: number }[] }[] = [];

  for (const key of groupBy) {
    const field = byKey.get(key);
    if (!field) continue;

    const tally = new Map<string, number>();
    for (const row of rows) {
      let value: string;
      try {
        const raw = field.resolve(row as never);
        value = raw == null || raw === "" ? "(blank)" : String(raw);
      } catch (err) {
        // The column is projected, so a throw here is a real defect in the
        // field's resolve() rather than a missing join. Swallowing it keeps
        // the answer alive, but it must not do so silently.
        console.error(`[ai.report] group_by "${key}" resolve() threw:`, err);
        value = "(blank)";
      }
      tally.set(value, (tally.get(value) ?? 0) + 1);
    }

    out.push({
      by: key,
      counts: [...tally.entries()]
        .map(([value, n]) => ({ value, n }))
        .sort((a, b) => b.n - a.n)
        .slice(0, 30),
    });
  }

  return out;
}

/** Output fields plus any group-by fields not already among them, in order. */
function unionFields(
  output: readonly ReportField[],
  extra: readonly ReportField[]
): ReportField[] {
  const seen = new Set(output.map((f) => f.key));
  const out = [...output];
  for (const field of extra) {
    if (seen.has(field.key)) continue;
    seen.add(field.key);
    out.push(field);
  }
  return out;
}

function mergeUnknown(
  a: readonly { key: string; didYouMean: string[] }[],
  b: readonly { key: string; didYouMean: string[] }[]
): { key: string; didYouMean: string[] }[] {
  const seen = new Set(a.map((u) => u.key));
  return [...a, ...b.filter((u) => !seen.has(u.key))];
}

function mergeWithheld(
  a: readonly { key: string; reason: "sensitive" | "not_permitted" }[],
  b: readonly { key: string; reason: "sensitive" | "not_permitted" }[]
): { key: string; reason: "sensitive" | "not_permitted" }[] {
  const seen = new Set(a.map((w) => w.key));
  return [...a, ...b.filter((w) => !seen.has(w.key))];
}
