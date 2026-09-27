import { headers } from "next/headers";
import { createAdminClient } from "@nkps/shared/lib/supabase/admin";

/**
 * Portal-side counterpart to `verify-admin.ts`.
 *
 * Kept in its own module on purpose: every helper in `verify-admin.ts` is
 * staff-shaped (admin / editor / teacher), and `canHoldEditorCapability()`
 * restricts editor grants to staff|teacher — so a parent or student can never
 * satisfy any of them. Putting a parent helper in that file would invite
 * someone to reach for the wrong one.
 *
 * Conventions match `verify-admin.ts` deliberately:
 *  - Bearer token only, read from the Authorization header.
 *  - Returns the SERVICE-ROLE client. Row scoping is this module's job
 *    (`studentIds`), never RLS's — see the header of
 *    `apps/erp/src/lib/ai/caller-context.ts` for why.
 *  - `null` on any failure, and fails closed on `must_change_password`.
 */

export type PortalRole = "parent" | "student";

export interface PortalUser {
  /** Service-role client. Callers MUST scope reads with `studentIds`. */
  admin: ReturnType<typeof createAdminClient>;
  userId: string;
  email: string | null;
  role: PortalRole;
  /** Set when role === "parent". */
  parentId: string | null;
  /** Set when role === "student". */
  studentId: string | null;
  /**
   * The ONLY legitimate source of row scope on this channel.
   *
   * Parent: every linked child that has an enrollment in the current academic
   * session. Student: `[self]`.
   *
   * Resolved fresh on every call — never cache it across requests, and never
   * take it from user input.
   */
  studentIds: string[];
}

interface VerifyPortalUserOptions {
  /** Roles allowed through. Defaults to both. */
  allow?: readonly PortalRole[];
}

function readBearerToken(authHeader: string | null) {
  if (!authHeader?.startsWith("Bearer ")) return null;
  return authHeader.slice(7);
}

/**
 * Resolves a parent's wards.
 *
 * Deliberately NOT `get_my_children_ids()`: that SQL helper resolves through
 * `auth.uid()`, which is NULL under a service-role client, so it would return
 * an empty set rather than an error — the same silent-empty failure mode that
 * `bus_stops` (RLS on, zero policies) exhibits. Scope must be derived in
 * explicit TypeScript where a mistake is visible.
 *
 * Children with no enrollment in the current session are excluded: a parent of
 * a passed-out student should not keep live access to school data.
 */
async function resolveWardIds(
  admin: ReturnType<typeof createAdminClient>,
  parentId: string
): Promise<string[]> {
  const { data: links } = await admin
    .from("student_parents")
    .select("student_id")
    .eq("parent_id", parentId);

  const linked = (links ?? [])
    .map((row) => row.student_id as string)
    .filter(Boolean);
  if (linked.length === 0) return [];

  const { data: currentYear } = await admin
    .from("academic_years")
    .select("id")
    .eq("is_current", true)
    .limit(1)
    .maybeSingle();

  // No current session configured: fail closed rather than granting the full
  // linked set, which would silently widen scope during a session rollover.
  if (!currentYear?.id) return [];

  const { data: enrolled } = await admin
    .from("student_enrollments")
    .select("student_id")
    .eq("academic_year_id", currentYear.id)
    .in("student_id", linked);

  return [...new Set((enrolled ?? []).map((row) => row.student_id as string))];
}

/**
 * Verifies the request comes from an authenticated parent or student and
 * resolves the exact set of students they may read.
 *
 * Returns `null` — never throws — so callers respond 401/403 on their own
 * terms, matching how the `verify-admin.ts` helpers are used.
 */
export async function verifyPortalUser(
  options?: VerifyPortalUserOptions
): Promise<PortalUser | null> {
  const allow = options?.allow ?? (["parent", "student"] as const);

  const headersList = await headers();
  const accessToken = readBearerToken(headersList.get("authorization"));
  if (!accessToken) return null;

  const admin = createAdminClient();
  const {
    data: { user },
    error,
  } = await admin.auth.getUser(accessToken);
  if (error || !user) return null;

  const { data: profile } = await admin
    .from("profiles")
    .select("role, must_change_password, parent_id, student_id, email")
    .eq("id", user.id)
    .single();

  if (!profile || profile.must_change_password) return null;

  const role = profile.role as string;
  if (role !== "parent" && role !== "student") return null;
  if (!allow.includes(role)) return null;

  if (role === "parent") {
    // A parent profile with no linked parent record is a broken link, not a
    // parent with zero children — treat it as unauthenticated.
    if (!profile.parent_id) return null;
    return {
      admin,
      userId: user.id,
      email: profile.email ?? user.email ?? null,
      role: "parent",
      parentId: profile.parent_id as string,
      studentId: null,
      studentIds: await resolveWardIds(admin, profile.parent_id as string),
    };
  }

  if (!profile.student_id) return null;
  return {
    admin,
    userId: user.id,
    email: profile.email ?? user.email ?? null,
    role: "student",
    parentId: null,
    studentId: profile.student_id as string,
    studentIds: [profile.student_id as string],
  };
}
