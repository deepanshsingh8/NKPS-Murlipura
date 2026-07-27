import type { SupabaseClient } from "@supabase/supabase-js";

// Admission-number allocation shared by the registration-approval and the
// admin user-create paths. Both turn an email into a default admission number,
// so both need the same collision handling — otherwise two "firstname@…" users
// collide on the UNIQUE(admission_no) constraint and the second student insert
// fails, stranding the account with role='student' and no students row.

export async function isAdmissionNoTaken(
  supabase: SupabaseClient,
  candidate: string
): Promise<boolean> {
  const { data } = await supabase
    .from("students")
    .select("id")
    .eq("admission_no", candidate)
    .maybeSingle();
  return !!data;
}

/**
 * Pick a free admission number for a brand-new student. Tries the email
 * local-part first (preserves the historical default for the common case) and
 * falls back to a year-prefixed random tag if it's taken.
 */
export async function pickFreeAdmissionNo(
  supabase: SupabaseClient,
  email: string,
  year: number = new Date().getFullYear()
): Promise<string> {
  const localPart = email.split("@")[0]?.replace(/[^A-Za-z0-9_-]/g, "") ?? "";
  if (localPart && !(await isAdmissionNoTaken(supabase, localPart))) {
    return localPart;
  }
  for (let attempt = 0; attempt < 5; attempt++) {
    const suffix = Math.random().toString(36).slice(2, 8).toUpperCase();
    const candidate = `${year}-${suffix}`;
    if (!(await isAdmissionNoTaken(supabase, candidate))) return candidate;
  }
  // Extremely unlikely fallthrough — return a timestamp-based id which is
  // effectively unique and let the DB unique constraint be the final guard.
  return `${year}-${Date.now()}`;
}
