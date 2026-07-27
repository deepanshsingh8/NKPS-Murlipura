/**
 * Canonical identity-linking service — the ONE place that connects an auth
 * account (profiles row) to a domain record (teachers / students / parents),
 * and a parent to their ward (student_parents).
 *
 * Why this exists
 * ---------------
 * Linking used to be re-implemented in 5 routes, each subtly different. The
 * critical bug they all shared: after migration 061 stopped `handle_new_user`
 * from trusting the client-supplied role (every signup becomes role='student'),
 * the creation paths set `teacher_id` / `parent_id` but never updated `role`.
 * Result: teachers and parents were silently left as role='student', routed to
 * the wrong dashboard, and invisible to the parent/teacher views. (Students
 * worked only by accident, since 'student' is the hardcoded default.)
 *
 * Invariants this service guarantees (and migration 068 enforces in the DB):
 *   - role and the matching link column are always set in the SAME update,
 *     so the `enforce_profile_role_link` trigger is always satisfied.
 *   - 1:1 — a teacher/student/parent record is claimed by at most one account
 *     (the UNIQUE partial indexes from migration 068; surfaced here as a clean
 *     409 instead of a raw 23505).
 *   - every function is idempotent: re-linking to the same target is a no-op
 *     success; linking to a different target while already claimed is a 409.
 *
 * Always call with the SERVICE-ROLE client (createAdminClient()). These writes
 * touch privileged profile columns that the migration-061 guard only permits
 * for the service role / admins.
 */
import { randomBytes } from "crypto";
import type { createAdminClient } from "@nkps/shared/lib/supabase/admin";

type Admin = ReturnType<typeof createAdminClient>;
type Relationship = "father" | "mother" | "guardian";

export type LinkOk = {
  ok: true;
  alreadyLinked: boolean;
  /** Set by linkParentToStudentRecord: was this the first guardian on the student? */
  isPrimaryContact?: boolean;
};
export type LinkErr = { ok: false; error: string; status: number };
export type LinkResult = LinkOk | LinkErr;

const PG_UNIQUE_VIOLATION = "23505";

/** Connect an account to a teacher record (role := 'teacher', teacher_id := …). */
export async function linkProfileToTeacher(
  admin: Admin,
  profileId: string,
  teacherId: string
): Promise<LinkResult> {
  const { data: profile } = await admin
    .from("profiles")
    .select("teacher_id")
    .eq("id", profileId)
    .maybeSingle();
  if (!profile) return { ok: false, error: "Account not found", status: 404 };
  if (profile.teacher_id === teacherId) return { ok: true, alreadyLinked: true };
  if (profile.teacher_id) {
    return {
      ok: false,
      error: "This account is already linked to a different teacher record. Unlink it first.",
      status: 409,
    };
  }

  // role + link in one statement → satisfies enforce_profile_role_link.
  const { error } = await admin
    .from("profiles")
    .update({ role: "teacher", teacher_id: teacherId, student_id: null, parent_id: null })
    .eq("id", profileId);
  if (error) return mapLinkError(error, "teacher");
  return { ok: true, alreadyLinked: false };
}

/**
 * Find-or-create the `teachers` record for an account. Reuses an existing,
 * UNCLAIMED teacher matched by email (so promoting a login that's already in
 * the Teachers directory links the right row instead of duplicating it),
 * otherwise provisions a fresh one with a generated employee_id. Mirrors
 * ensureParentRecord — used when an admin flips a login to role='teacher' and
 * it has no teacher_id yet.
 */
export async function ensureTeacherRecord(
  admin: Admin,
  opts: { email: string | null; fullName: string; phone?: string | null }
): Promise<{ teacherId: string } | { error: string; status: number }> {
  if (opts.email) {
    const { data: existing } = await admin
      .from("teachers")
      .select("id")
      .eq("email", opts.email)
      .maybeSingle();
    if (existing) {
      // Only reuse it if no other account has already claimed it.
      const { data: claimedBy } = await admin
        .from("profiles")
        .select("id")
        .eq("teacher_id", existing.id)
        .maybeSingle();
      if (!claimedBy) return { teacherId: existing.id as string };
    }
  }
  // Same employee_id scheme as staff-teacher-sync / registration approve.
  const employeeId = `TCH-${Date.now().toString(36).toUpperCase()}-${randomBytes(2)
    .toString("hex")
    .toUpperCase()}`;
  const { data: created, error } = await admin
    .from("teachers")
    .insert({
      employee_id: employeeId,
      full_name: opts.fullName,
      email: opts.email,
      phone: opts.phone || null,
    })
    .select("id")
    .single();
  if (error || !created) {
    console.error("[identity] ensureTeacherRecord:", error);
    return { error: "Failed to set up the teacher record.", status: 500 };
  }
  return { teacherId: created.id as string };
}

/** Connect an account to a student record (role := 'student', student_id := …). */
export async function linkProfileToStudent(
  admin: Admin,
  profileId: string,
  studentId: string
): Promise<LinkResult> {
  const { data: claimedBy } = await admin
    .from("profiles")
    .select("id")
    .eq("student_id", studentId)
    .neq("id", profileId)
    .maybeSingle();
  if (claimedBy) {
    return {
      ok: false,
      error: "This student record is already linked to another account. Unlink it first.",
      status: 409,
    };
  }

  const { data: profile } = await admin
    .from("profiles")
    .select("student_id")
    .eq("id", profileId)
    .maybeSingle();
  if (!profile) return { ok: false, error: "Account not found", status: 404 };
  if (profile.student_id === studentId) return { ok: true, alreadyLinked: true };

  const { error } = await admin
    .from("profiles")
    .update({ role: "student", student_id: studentId, teacher_id: null, parent_id: null })
    .eq("id", profileId);
  if (error) return mapLinkError(error, "student");
  return { ok: true, alreadyLinked: false };
}

/**
 * Find-or-create the `parents` record for an account. Matches an existing row
 * by email first (the column is UNIQUE — a duplicate insert is the classic
 * silent failure we're eliminating), otherwise provisions a fresh one.
 */
export async function ensureParentRecord(
  admin: Admin,
  opts: { email: string | null; fullName: string; phone?: string | null }
): Promise<{ parentId: string } | { error: string; status: number }> {
  if (opts.email) {
    const { data: existing } = await admin
      .from("parents")
      .select("id")
      .eq("email", opts.email)
      .maybeSingle();
    if (existing) return { parentId: existing.id as string };
  }
  const { data: created, error } = await admin
    .from("parents")
    .insert({
      full_name: opts.fullName,
      email: opts.email,
      phone: opts.phone || "",
      // parents.relationship is DEPRECATED (migration 068); the authoritative
      // per-link relationship lives in student_parents. We still write a value
      // because the column is NOT NULL, but nothing reads it.
      relationship: "guardian",
    })
    .select("id")
    .single();
  if (error || !created) {
    console.error("[identity] ensureParentRecord:", error);
    return { error: "Failed to set up the parent record.", status: 500 };
  }
  return { parentId: created.id as string };
}

/** Connect an account to a parent record (role := 'parent', parent_id := …). */
export async function linkProfileToParent(
  admin: Admin,
  profileId: string,
  parentId: string
): Promise<LinkResult> {
  const { data: profile } = await admin
    .from("profiles")
    .select("parent_id")
    .eq("id", profileId)
    .maybeSingle();
  if (!profile) return { ok: false, error: "Account not found", status: 404 };
  if (profile.parent_id === parentId) return { ok: true, alreadyLinked: true };
  if (profile.parent_id) {
    return {
      ok: false,
      error: "This account is already linked to a different parent record. Unlink it first.",
      status: 409,
    };
  }

  const { error } = await admin
    .from("profiles")
    .update({ role: "parent", parent_id: parentId, teacher_id: null, student_id: null })
    .eq("id", profileId);
  if (error) return mapLinkError(error, "parent");
  return { ok: true, alreadyLinked: false };
}

/**
 * Link a parent record to a student (student_parents junction). Computes
 * is_primary_contact (first guardian on the student) and is idempotent on the
 * UNIQUE(student_id, parent_id) constraint.
 */
export async function linkParentToStudentRecord(
  admin: Admin,
  opts: { studentId: string; parentId: string; relationship: Relationship }
): Promise<LinkResult> {
  const { data: existing } = await admin
    .from("student_parents")
    .select("id")
    .eq("student_id", opts.studentId)
    .eq("parent_id", opts.parentId)
    .maybeSingle();
  if (existing) return { ok: true, alreadyLinked: true };

  const { count } = await admin
    .from("student_parents")
    .select("id", { count: "exact", head: true })
    .eq("student_id", opts.studentId);
  const isPrimaryContact = (count ?? 0) === 0;

  const { error } = await admin.from("student_parents").insert({
    student_id: opts.studentId,
    parent_id: opts.parentId,
    relationship: opts.relationship,
    is_primary_contact: isPrimaryContact,
  });
  if (error) {
    if (error.code === PG_UNIQUE_VIOLATION) return { ok: true, alreadyLinked: true };
    console.error("[identity] linkParentToStudentRecord:", error);
    return { ok: false, error: "Failed to link the child to this parent.", status: 500 };
  }
  return { ok: true, alreadyLinked: false, isPrimaryContact };
}

/**
 * High-level compose used by every parent-linking entry point (approve,
 * admin repair tool, parent self-serve): ensure the parents row exists, set
 * role='parent' + parent_id, and create the student_parents link — in that
 * order, so the profile is always in a valid (trigger-satisfying) state even
 * if a later step fails.
 */
export async function linkParentAccountToStudent(
  admin: Admin,
  opts: {
    profileId: string;
    profile: { email: string | null; fullName: string; phone?: string | null };
    studentId: string;
    relationship: Relationship;
  }
): Promise<LinkResult> {
  const parent = await ensureParentRecord(admin, {
    email: opts.profile.email,
    fullName: opts.profile.fullName,
    phone: opts.profile.phone,
  });
  if ("error" in parent) return { ok: false, error: parent.error, status: parent.status };

  const profileLink = await linkProfileToParent(admin, opts.profileId, parent.parentId);
  if (!profileLink.ok) return profileLink;

  return linkParentToStudentRecord(admin, {
    studentId: opts.studentId,
    parentId: parent.parentId,
    relationship: opts.relationship,
  });
}

function mapLinkError(
  error: { code?: string; message?: string },
  kind: "teacher" | "student" | "parent"
): LinkErr {
  if (error.code === PG_UNIQUE_VIOLATION) {
    return {
      ok: false,
      error: `This ${kind} record is already linked to another account. Unlink it first.`,
      status: 409,
    };
  }
  console.error(`[identity] linkProfileTo${kind}:`, error);
  return { ok: false, error: `Failed to link the ${kind} account.`, status: 500 };
}
