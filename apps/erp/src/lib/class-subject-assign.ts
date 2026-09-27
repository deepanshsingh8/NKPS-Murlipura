import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Writing (class, subject, teacher) rows into `class_subjects`.
 *
 * ── Why this exists ─────────────────────────────────────────────────────────
 * Three call sites grew their own copy of the same job — resolve the pairs,
 * skip the ones already assigned, insert the rest, count what happened:
 * the CBSE Quick Setup wizard, the Excel bulk upload, and the per-row Assign
 * dialog. Each looped one insert per row and each reported its outcome in a
 * slightly different shape. The class-first "manage all of a class's subjects
 * at once" flow would have been a fourth.
 *
 * What is shared is the *id-level* write, and only that. Name resolution is
 * genuinely different per caller — Quick Setup keys classes on stream NAME,
 * the Excel importer resolves a stream name to an id first and can create
 * missing subjects, and the id-based callers need neither — so that stays with
 * each caller rather than being forced through one leaky signature.
 */

export interface ClassSubjectPair {
  class_id: string;
  subject_id: string;
  /** Left alone on rows that already exist — see the note on skipping below. */
  teacher_id?: string | null;
  /** Human label for error reporting, e.g. "VI-B / Mathematics". */
  label?: string;
}

export interface AssignOutcome {
  created: number;
  skipped: number;
  errors: { label: string; error: string }[];
  /** The pairs that would be (or were) created, after de-duplication. */
  plan: ClassSubjectPair[];
}

const CHUNK = 500;

function pairKey(p: { class_id: string; subject_id: string }) {
  return `${p.class_id}|${p.subject_id}`;
}

/**
 * Assign subjects to classes, skipping any pair that already exists.
 *
 * Existing rows are never touched — not their teacher, not anything. A caller
 * that wants to change a teacher should update that row directly. This matters
 * for the wing-wide apply in particular: pushing a subject set onto nine
 * classes must not blank the teachers someone already filled in.
 *
 * `dryRun` returns the same counts with nothing written, so a UI can show
 * "42 will be created, 13 already there" before the admin commits.
 */
export async function assignSubjectsToClasses(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: SupabaseClient<any, any, any>,
  pairs: ClassSubjectPair[],
  opts: { dryRun?: boolean } = {}
): Promise<AssignOutcome> {
  const errors: { label: string; error: string }[] = [];
  if (pairs.length === 0) {
    return { created: 0, skipped: 0, errors, plan: [] };
  }

  // What is already assigned, for the classes in this request only.
  const classIds = [...new Set(pairs.map((p) => p.class_id))];
  const existing = new Set<string>();
  for (let i = 0; i < classIds.length; i += CHUNK) {
    const { data, error } = await admin
      .from("class_subjects")
      .select("class_id, subject_id")
      .in("class_id", classIds.slice(i, i + CHUNK));
    if (error) {
      // Without the skip set every insert would race the unique constraint and
      // the counts would be fiction. Better to say so than to guess.
      return {
        created: 0,
        skipped: 0,
        errors: [{ label: "", error: "Could not read existing assignments" }],
        plan: [],
      };
    }
    for (const row of data ?? []) existing.add(pairKey(row));
  }

  // De-duplicate within the request too: two spreadsheet rows for the same
  // class and subject are one assignment, not one plus a constraint violation.
  const plan: ClassSubjectPair[] = [];
  const seen = new Set<string>();
  let skipped = 0;
  for (const p of pairs) {
    const key = pairKey(p);
    if (existing.has(key) || seen.has(key)) {
      skipped++;
      continue;
    }
    seen.add(key);
    plan.push(p);
  }

  if (opts.dryRun || plan.length === 0) {
    return { created: 0, skipped, errors, plan };
  }

  let created = 0;
  for (let i = 0; i < plan.length; i += CHUNK) {
    const chunk = plan.slice(i, i + CHUNK);
    const rows = chunk.map((p) => ({
      class_id: p.class_id,
      subject_id: p.subject_id,
      teacher_id: p.teacher_id ?? null,
    }));

    const { error } = await admin
      .from("class_subjects")
      .upsert(rows, { onConflict: "class_id,subject_id", ignoreDuplicates: true });

    if (!error) {
      created += chunk.length;
      continue;
    }

    // One bad row must not cost the other 499. Fall back to row-at-a-time for
    // this chunk only, so the failure can be attributed and reported.
    for (const p of chunk) {
      const { error: rowErr } = await admin.from("class_subjects").insert({
        class_id: p.class_id,
        subject_id: p.subject_id,
        teacher_id: p.teacher_id ?? null,
      });
      if (!rowErr) {
        created++;
      } else if (rowErr.code === "23505") {
        // Someone else assigned it between our read and our write.
        skipped++;
      } else {
        errors.push({
          label: p.label ?? `${p.class_id}/${p.subject_id}`,
          error: rowErr.message,
        });
      }
    }
  }

  return { created, skipped, errors, plan };
}
