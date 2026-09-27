/**
 * Resolving a student from a typed admission number.
 *
 * Why this exists
 * ---------------
 * Every "prove who your child is" flow (parent Add Child, a student claiming
 * their own record, the admin repair tool, registration approval) matched the
 * admission number with a bare `.eq()`. That is a byte comparison, so it fails
 * on the two things people actually do:
 *
 *   - type or paste it in a different case — "nkps-2024-0001" vs the stored
 *     "NKPS-2024-0001";
 *   - a stored value carrying stray whitespace from a spreadsheet import. The
 *     bulk importer already defends against this (it trims every admission_no
 *     it reads back out of the table), but the verification paths did not.
 *
 * Both came back to the parent as the same deliberately-vague "we couldn't
 * verify a child with those details", which reads as "your details are wrong"
 * when the details were right all along.
 *
 * The admission number is an identifier, not a secret — case and surrounding
 * whitespace are data-entry noise, not identity. Date of birth is what the
 * verification actually rests on, and that is still compared exactly.
 */
import type { createAdminClient } from "@nkps/shared/lib/supabase/admin";

type Admin = ReturnType<typeof createAdminClient>;

/** Case and surrounding whitespace folded away, for comparing two numbers. */
export function normalizeAdmissionNo(value: string): string {
  return value.trim().toLowerCase();
}

// `_` is legal in an admission number and is also LIKE's single-character
// wildcard, so it has to be escaped before the value goes into a pattern.
// (`%` and `*` can't occur — the admission-number charset excludes them — but
// escaping them costs nothing and keeps the helper honest if that changes.)
function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_*]/g, (char) => `\\${char}`);
}

/**
 * Find the one student whose admission number matches `input`, ignoring case
 * and surrounding whitespace on both sides.
 *
 * Three escalating attempts, cheapest first — the common case is the exact
 * match, which uses the unique index and costs one round trip:
 *   1. exact
 *   2. case-insensitive exact
 *   3. contains-scan, then an exact normalized comparison in JS
 *
 * Returns null when nothing matches, and also when step 3 turns up more than
 * one student — an ambiguous match must never be resolved by guessing.
 */
export async function findStudentByAdmissionNo<T extends { admission_no: string }>(
  admin: Admin,
  input: string,
  columns: string
): Promise<T | null> {
  const trimmed = input.trim();
  if (!trimmed) return null;

  // `columns` is a runtime string, so PostgREST's types can't narrow the row —
  // the shape is the caller's `T` by contract, hence the casts.
  const { data: exact } = await admin
    .from("students")
    .select(columns)
    .eq("admission_no", trimmed)
    .maybeSingle();
  if (exact) return exact as unknown as T;

  const pattern = escapeLikePattern(trimmed);
  const { data: caseInsensitive } = await admin
    .from("students")
    .select(columns)
    .ilike("admission_no", pattern)
    .limit(2);
  if (caseInsensitive?.length === 1) return caseInsensitive[0] as unknown as T;
  if (caseInsensitive && caseInsensitive.length > 1) return null;

  // Last resort: the stored value may be padded with whitespace, which no
  // anchored pattern can express. Pull the rows that contain the number and
  // settle it with an exact normalized comparison here. Guarded on length so a
  // one- or two-character entry can't drag half the directory back.
  const normalized = normalizeAdmissionNo(trimmed);
  if (normalized.length < 3) return null;

  const { data: candidates } = await admin
    .from("students")
    .select(columns)
    .ilike("admission_no", `%${pattern}%`)
    .limit(50);

  const matches = ((candidates ?? []) as unknown as T[]).filter(
    (row) => normalizeAdmissionNo(String(row.admission_no)) === normalized
  );
  return matches.length === 1 ? matches[0]! : null;
}

/**
 * Does a stored date of birth fall on the same calendar day as the submitted
 * `YYYY-MM-DD`?
 *
 * `students.date_of_birth` is a `date`, which PostgREST renders as
 * `YYYY-MM-DD` — but a value that ever passed through a timestamp column comes
 * back as `YYYY-MM-DDTHH:MM:SS`, and `===` on the raw strings then rejects a
 * correct date. Compare the day, which is all a date of birth ever means.
 */
export function isSameDateOfBirth(
  stored: string | null | undefined,
  submitted: string
): boolean {
  if (!stored) return false;
  return stored.slice(0, 10) === submitted.slice(0, 10);
}
