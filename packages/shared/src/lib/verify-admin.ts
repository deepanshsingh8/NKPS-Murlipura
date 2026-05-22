import { headers } from "next/headers";
import { createAdminClient } from "@nkps/shared/lib/supabase/admin";
import type { FeatureKey } from "@nkps/shared/lib/permissions";

/**
 * Why we re-check `must_change_password` here even though middleware does it:
 *  - Middleware redirects only browser navigations.
 *  - These helpers gate API routes hit by direct fetch, scripts, or admin
 *    tools, where there's no redirect to fall back on.
 *
 * The forced-change flow itself talks to Supabase Auth directly with the user
 * token, so it is NOT routed through these helpers.
 */

function readBearerToken(authHeader: string | null) {
  if (!authHeader?.startsWith("Bearer ")) return null;
  return authHeader.slice(7);
}

async function loadCaller(accessToken: string) {
  const admin = createAdminClient();
  const {
    data: { user },
    error,
  } = await admin.auth.getUser(accessToken);
  if (error || !user) return { admin, user: null, profile: null } as const;
  const { data: profile } = await admin
    .from("profiles")
    .select("role, must_change_password")
    .eq("id", user.id)
    .single();
  return { admin, user, profile } as const;
}

/**
 * Verifies the current request is from an authenticated admin user.
 * Reads the access token from the Authorization header (sent by the browser client).
 * Returns the admin (service role) Supabase client if verified, null otherwise.
 *
 * Fails closed if `must_change_password = true`.
 */
export async function verifyAdmin() {
  const headersList = await headers();
  const accessToken = readBearerToken(headersList.get("authorization"));
  if (!accessToken) return null;

  const { admin, user, profile } = await loadCaller(accessToken);
  if (!user || !profile) return null;
  if (profile.must_change_password) return null;
  if (profile.role !== "admin") return null;
  return admin;
}

/**
 * Like verifyAdmin but also returns the authenticated user — used by routes
 * that need to record `actor_id` or rate-limit per actor without making a
 * second call to `getUser()`.
 *
 * Fails closed if `must_change_password = true`.
 */
export async function verifyAdminWithUser() {
  const headersList = await headers();
  const accessToken = readBearerToken(headersList.get("authorization"));
  if (!accessToken) return null;

  const { admin, user, profile } = await loadCaller(accessToken);
  if (!user || !profile) return null;
  if (profile.must_change_password) return null;
  if (profile.role !== "admin") return null;
  return { admin, user };
}

/**
 * Like verifyAdmin but also allows the editor capability — i.e., a row in
 * editor_permissions for the given featureKey, regardless of base role.
 * Admins always pass.
 *
 * If featureKey is omitted, any non-admin caller must have at least one
 * editor_permissions row to pass.
 *
 * Fails closed if `must_change_password = true`.
 */
export async function verifyAdminOrEditor(featureKey?: FeatureKey) {
  const headersList = await headers();
  const accessToken = readBearerToken(headersList.get("authorization"));
  if (!accessToken) return null;

  const { admin, user, profile } = await loadCaller(accessToken);
  if (!user || !profile) return null;
  if (profile.must_change_password) return null;
  if (profile.role === "admin") return admin;

  const query = admin
    .from("editor_permissions")
    .select("feature_key")
    .eq("editor_id", user.id);
  const { data: perm } = featureKey
    ? await query.eq("feature_key", featureKey).maybeSingle()
    : await query.limit(1).maybeSingle();
  if (!perm) return null;
  return admin;
}

/**
 * Returns the admin/editor's effective access profile — used by dashboard-style
 * endpoints that need to tailor the response to what the caller is allowed to
 * see. `isAdmin=true` implies full access regardless of the permissions set.
 * Returns null if the caller is not an admin or editor.
 *
 * Fails closed if `must_change_password = true`.
 */
export async function getCallerAccess(): Promise<
  | { admin: ReturnType<typeof createAdminClient>; isAdmin: true; permissions: Set<FeatureKey> }
  | { admin: ReturnType<typeof createAdminClient>; isAdmin: false; permissions: Set<FeatureKey> }
  | null
> {
  const headersList = await headers();
  const accessToken = readBearerToken(headersList.get("authorization"));
  if (!accessToken) return null;

  const { admin, user, profile } = await loadCaller(accessToken);
  if (!user || !profile) return null;
  if (profile.must_change_password) return null;
  if (profile.role === "admin") {
    return { admin, isAdmin: true, permissions: new Set() };
  }

  const { data: rows } = await admin
    .from("editor_permissions")
    .select("feature_key")
    .eq("editor_id", user.id);
  const permissions = new Set<FeatureKey>();
  for (const r of rows ?? []) {
    if (r.feature_key) permissions.add(r.feature_key as FeatureKey);
  }
  if (permissions.size === 0) return null;
  return { admin, isAdmin: false, permissions };
}

/**
 * Same as verifyAdminOrEditor but also returns the authenticated user so the
 * caller can log actor_id / set created_by / etc. Returns null if
 * unauthorized.
 *
 * The returned `role` discriminates admin vs editor — used by routes that
 * need to gate further actions (e.g. fees-editors can create payments
 * directly but must file a change request for edits/deletes; admins
 * skip the request flow).
 *
 * Fails closed if `must_change_password = true`.
 */
export async function verifyAdminOrEditorWithUser(featureKey?: FeatureKey) {
  const headersList = await headers();
  const accessToken = readBearerToken(headersList.get("authorization"));
  if (!accessToken) return null;

  const { admin, user, profile } = await loadCaller(accessToken);
  if (!user || !profile) return null;
  if (profile.must_change_password) return null;
  if (profile.role === "admin") {
    return { admin, user, role: "admin" as const };
  }

  const query = admin
    .from("editor_permissions")
    .select("feature_key")
    .eq("editor_id", user.id);
  const { data: perm } = featureKey
    ? await query.eq("feature_key", featureKey).maybeSingle()
    : await query.limit(1).maybeSingle();
  if (!perm) return null;
  return { admin, user, role: "editor" as const };
}
