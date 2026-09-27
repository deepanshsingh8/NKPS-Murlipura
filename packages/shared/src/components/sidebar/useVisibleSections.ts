"use client";

import { useMemo } from "react";
import type { UserRole } from "@nkps/shared/types";
import {
  featureKeyForPath,
  type FeatureKey,
} from "@nkps/shared/lib/permissions";
import { useSession } from "@nkps/shared/components/providers/SessionProvider";
import type { SidebarItem, SidebarSection } from "./nav";

/** Whether a sidebar's links are subject to editor feature grants at all. */
export type NavGate = "permissions" | "none";

export interface VisibleNav {
  sections: SidebarSection[];
  /**
   * False while a non-admin's grants are still loading. Consumers render an
   * empty pane rather than a list they are about to take links out of.
   */
  ready: boolean;
  isAdmin: boolean;
}

// Exact-href lookup covers most sidebar items. Sub-routes that fall under a
// feature umbrella (e.g. /fees/academic) aren't in the catalog by themselves —
// featureKeyForPath resolves those by longest-prefix match so the whole tree is
// gated by a single feature key.
//
// This delegates rather than re-deriving the mapping, and that is the whole
// point: it used to be a second copy of the prefix-matching logic, which
// drifted. Routes that do not sit under their feature's href (streams,
// electives, the timetable tools, the approval queues) resolved to a key in
// middleware but to null here, so an editor holding the right grant could reach
// the page and still not see it in the sidebar. One resolver, one answer.
//
// featureKeyForPath also returns null for admin-only paths, which is exactly
// what the filter below wants: hidden from everyone who is not an admin.
function resolveFeatureKey(href: string): FeatureKey | null {
  return featureKeyForPath(href);
}

/**
 * Filters a nav tree down to what the signed-in user may actually open.
 *
 * Shared by the desktop pane and the mobile drawer. Two copies of this would
 * be two chances to leak a link an editor cannot use — and the drawer's search
 * flattens the tree, which would make any such leak more findable, not less.
 */
export function useVisibleSections({
  sections,
  gate = "permissions",
  editorAlwaysAllowedHrefs,
}: {
  sections: readonly SidebarSection[];
  gate?: NavGate;
  /** Hrefs always shown to staff/teachers regardless of feature grants —
   *  typically the module dashboard. */
  editorAlwaysAllowedHrefs?: ReadonlySet<string>;
}): VisibleNav {
  const { profile, editorPermissions } = useSession();

  // Assume admin until the profile lands — the sidebar has always rendered
  // optimistically and then filtered down, and inverting that would trade a
  // brief flash of extra links for a brief flash of an empty pane.
  const userRole: UserRole = (profile?.role as UserRole) || "admin";
  const isAdmin = userRole === "admin";

  // A portal has no feature keys at all: every link in it belongs to the role
  // that can reach the portal in the first place, which the route gate has
  // already decided. Running it through the grant filter would hide the lot.
  const ungated = gate === "none";
  const ready = ungated || isAdmin || editorPermissions !== null;

  const visible = useMemo(() => {
    if (ungated) return sections as SidebarSection[];
    if (!ready) return sections.map((s) => ({ ...s, items: [] }));

    const allowed = (href: string): boolean => {
      if (isAdmin) return true;
      if (editorAlwaysAllowedHrefs?.has(href)) return true;
      const key = resolveFeatureKey(href);
      if (!key) return false;
      return editorPermissions?.has(key) ?? false;
    };

    const filterItem = (item: SidebarItem): SidebarItem | null => {
      if (item.kind === "link") return allowed(item.href) ? item : null;
      const children = item.children
        .map(filterItem)
        .filter((c): c is SidebarItem => c !== null);
      // A group whose every child was filtered out is an empty accordion.
      if (children.length === 0) return null;
      return { ...item, children };
    };

    return sections.map((s) => ({
      ...s,
      items: s.items.map(filterItem).filter((x): x is SidebarItem => x !== null),
    }));
  }, [sections, ungated, ready, isAdmin, editorAlwaysAllowedHrefs, editorPermissions]);

  return { sections: visible, ready, isAdmin };
}
