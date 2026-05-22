import type { SupabaseClient } from "@supabase/supabase-js";
import type { FeatureKey } from "@nkps/shared/lib/permissions";

// Cookie-auth gating helper. Most routes use createClient() (cookies) and
// only need to know whether the caller is an admin or holds the editor
// capability for a given feature_key. Editor capability is granted via the
// editor_permissions table and is independent of base role — admin always
// passes, and any other role passes only if the matching row exists.
// verifyAdmin* in verify-admin.ts solves the same problem for Bearer-auth.
export async function callerHasAdminOrEditorPerm(
  supabase: SupabaseClient,
  userId: string,
  featureKey: FeatureKey
): Promise<boolean> {
  const { data: profile } = await supabase
    .from("profiles")
    .select("role, must_change_password")
    .eq("id", userId)
    .single();
  if (!profile) return false;
  if (profile.must_change_password) return false;
  if (profile.role === "admin") return true;
  const { data: perm } = await supabase
    .from("editor_permissions")
    .select("feature_key")
    .eq("editor_id", userId)
    .eq("feature_key", featureKey)
    .maybeSingle();
  return !!perm;
}
