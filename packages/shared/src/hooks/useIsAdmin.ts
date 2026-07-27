"use client";

import { useEffect, useState } from "react";
import { createClient } from "@nkps/shared/lib/supabase/client";

/**
 * Client-side check for whether the signed-in user is an admin.
 *
 * Used to hide admin-only actions (buttons/dialogs) from editors on pages an
 * editor can otherwise reach via a granted feature. This is a UX guard only —
 * the underlying API routes still enforce admin-only access server-side, so a
 * missing button is defence-in-depth, not the security boundary.
 *
 * Returns `null` while the role is still loading so callers can render nothing
 * (rather than flashing an admin button to an editor before the role resolves).
 */
export function useIsAdmin(): boolean | null {
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);

  useEffect(() => {
    let active = true;
    const supabase = createClient();
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) {
        if (active) setIsAdmin(false);
        return;
      }
      supabase
        .from("profiles")
        .select("role")
        .eq("id", user.id)
        .single()
        .then(({ data }) => {
          if (active) setIsAdmin(data?.role === "admin");
        });
    });
    return () => {
      active = false;
    };
  }, []);

  return isAdmin;
}
