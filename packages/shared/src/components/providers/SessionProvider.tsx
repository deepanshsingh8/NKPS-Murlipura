"use client";

import { createContext, useContext, useEffect, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { createClient } from "@nkps/shared/lib/supabase/client";
import type { FeatureKey } from "@nkps/shared/lib/permissions";

// One fetch of "who is looking at this page" for the whole shell.
//
// The sidebar, the profile menu, the app switcher and useIsAdmin each used to
// resolve this for themselves: getUser() -> profiles (-> editor_permissions),
// four times over, strictly chained. Against a remote Supabase project that is
// ~10 round trips of pure duplication on every cold page load, and the sidebar
// alone paid three of them nose-to-tail before it could decide what to render.
//
// The provider sits in the layout, so it survives client-side navigation: the
// cost is paid once per full page load, not once per route change.

export interface SessionProfile {
  full_name: string | null;
  email: string | null;
  role: string | null;
  avatar_url: string | null;
}

export interface SessionState {
  /** True until the whole set has resolved — consumers render their own
   *  loading state off this rather than guessing from null fields. */
  loading: boolean;
  user: User | null;
  /** Null when signed out, or when the profile row could not be read. */
  profile: SessionProfile | null;
  /** Null while loading or signed out; a (possibly empty) set once resolved. */
  editorPermissions: Set<FeatureKey> | null;
}

const LOADING: SessionState = {
  loading: true,
  user: null,
  profile: null,
  editorPermissions: null,
};

const SIGNED_OUT: SessionState = {
  loading: false,
  user: null,
  profile: null,
  editorPermissions: null,
};

const SessionContext = createContext<SessionState | null>(null);

function useSessionQuery(enabled: boolean): SessionState {
  const [state, setState] = useState<SessionState>(LOADING);

  useEffect(() => {
    if (!enabled) return;
    let active = true;
    const supabase = createClient();

    (async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!active) return;
      if (!user) {
        setState(SIGNED_OUT);
        return;
      }

      // The profile row and the grant rows are independent once the id is
      // known, so they go out together. Chained — which is how the sidebar
      // used to do it — they cost two serial round trips before any nav item
      // could be filtered.
      const [profileRes, permRes] = await Promise.all([
        supabase
          .from("profiles")
          .select("full_name, email, role, avatar_url")
          .eq("id", user.id)
          .single(),
        supabase
          .from("editor_permissions")
          .select("feature_key")
          .eq("editor_id", user.id),
      ]);
      if (!active) return;

      const editorPermissions = new Set<FeatureKey>();
      for (const row of permRes.data ?? []) {
        if (row.feature_key) editorPermissions.add(row.feature_key as FeatureKey);
      }

      setState({
        loading: false,
        user,
        profile: (profileRes.data as SessionProfile | null) ?? null,
        editorPermissions,
      });
    })();

    return () => {
      active = false;
    };
  }, [enabled]);

  return state;
}

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const state = useSessionQuery(true);
  return (
    <SessionContext.Provider value={state}>{children}</SessionContext.Provider>
  );
}

export function useSession(): SessionState {
  const ctx = useContext(SessionContext);
  // Standalone fallback. Every shell mounts the provider, so this should stay
  // dead code — it exists because these components are shared across three
  // apps, and a consumer dropped into a tree without the provider must degrade
  // to its old self-fetching behaviour rather than hang on `loading` forever.
  // `enabled` is fixed for the lifetime of a mount point, so the extra hook
  // costs a render's worth of state and nothing else.
  const standalone = useSessionQuery(ctx === null);
  return ctx ?? standalone;
}
