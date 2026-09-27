// Editing a closed academic session.
//
// A past session opens read-only. Correcting it — a wrong class recorded three
// years ago, a misspelt name on a leaving certificate — is a real need, but it
// is also the one edit in this system with no natural witness: a bad change to
// the current session is noticed by a teacher within a day, a bad change to
// 2022-23 is noticed by nobody. So it requires an explicit unlock carrying a
// reason, it is admin-only, and it leaves a row in `historical_corrections`.
//
// The unlock is per-request, not a session-wide mode: the client sends it with
// each PATCH it makes while a record is unlocked, so nothing stays quietly
// unlocked in a tab left open over lunch.

import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Matched by a CHECK on the column. Long enough to be a sentence — "fix",
 * "typo" and "asdf" are not reasons anyone can review a year from now.
 */
export const MIN_CORRECTION_REASON = 10;

export interface HistoricalCorrection {
  reason: string;
}

export type CorrectionCheck =
  | { ok: true; correction: HistoricalCorrection | null }
  | { ok: false; error: string; status: number };

/**
 * Validate the unlock a request carries, if any.
 *
 * Returns `{ ok: true, correction: null }` when the request is an ordinary
 * edit — the caller then applies its normal rules.
 */
export function parseHistoricalCorrection(
  raw: unknown,
  role: string
): CorrectionCheck {
  if (raw === undefined || raw === null) return { ok: true, correction: null };

  if (typeof raw !== "object") {
    return { ok: false, error: "Malformed correction request", status: 400 };
  }
  const reason = String((raw as { reason?: unknown }).reason ?? "").trim();

  // Admin-only, and checked here rather than trusted from the UI: an editor
  // holding the `students` grant can edit the live session all day, but
  // rewriting a closed one is a different act.
  if (role !== "admin") {
    return {
      ok: false,
      error: "Only an admin can correct a closed academic session.",
      status: 403,
    };
  }
  if (reason.length < MIN_CORRECTION_REASON) {
    return {
      ok: false,
      error: `Give a reason of at least ${MIN_CORRECTION_REASON} characters for changing a closed session.`,
      status: 400,
    };
  }
  return { ok: true, correction: { reason } };
}

type Snapshot = Record<string, unknown> | null;

/** The columns that actually differ, so the log is readable without diffing. */
function changedColumns(before: Snapshot, after: Snapshot): string[] {
  if (!after) return [];
  const keys = new Set([...Object.keys(before ?? {}), ...Object.keys(after)]);
  const changed: string[] = [];
  for (const key of keys) {
    if (!(key in after)) continue;
    const a = before ? before[key] : undefined;
    const b = after[key];
    if (JSON.stringify(a ?? null) !== JSON.stringify(b ?? null)) changed.push(key);
  }
  return changed.sort();
}

export interface LogCorrectionOptions {
  actorId: string;
  actorRole: string;
  academicYearId: string | null;
  studentId: string | null;
  enrollmentId: string | null;
  targetTable: string;
  targetId: string | null;
  before: Snapshot;
  after: Snapshot;
  reason: string;
}

/**
 * Record one correction.
 *
 * Awaited, unlike the export audit: an export log that fails costs a record of
 * something that already happened harmlessly, whereas an unlogged rewrite of a
 * closed session is the exact thing the unlock exists to prevent. If this
 * cannot be written, the caller should treat the edit as failed.
 */
export async function logHistoricalCorrection(
  admin: SupabaseClient,
  options: LogCorrectionOptions
): Promise<{ ok: boolean; error?: string }> {
  const columns = changedColumns(options.before, options.after);
  // Nothing actually differed — an unlock that changed nothing is not an event.
  if (columns.length === 0) return { ok: true };

  const { error } = await admin.from("historical_corrections").insert({
    actor_id: options.actorId,
    actor_role: options.actorRole,
    academic_year_id: options.academicYearId,
    student_id: options.studentId,
    enrollment_id: options.enrollmentId,
    target_table: options.targetTable,
    target_id: options.targetId,
    changed_columns: columns,
    // Only the differing columns are stored: a fifty-column students row would
    // otherwise bury the one field that changed.
    before_snapshot: pick(options.before, columns),
    after_snapshot: pick(options.after, columns),
    reason: options.reason,
  });

  if (error) {
    console.error("historical_corrections insert failed:", error);
    return { ok: false, error: error.message };
  }
  return { ok: true };
}

function pick(source: Snapshot, keys: string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (!source) return out;
  for (const key of keys) out[key] = source[key] ?? null;
  return out;
}
