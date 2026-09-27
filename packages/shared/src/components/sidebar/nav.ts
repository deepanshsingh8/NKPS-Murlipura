import type { LucideIcon } from "lucide-react";

// The shape of a sidebar, and the handful of questions every renderer of one
// needs to ask. Extracted from SidebarShell when the mobile drawer arrived:
// the two render completely different trees from the same data, and "is this
// item active?" answered two ways is how an active state ends up disagreeing
// with itself between breakpoints.

export type SidebarLink = {
  kind: "link";
  icon: LucideIcon;
  label: string;
  href: string;
};

export type SidebarGroup = {
  kind: "group";
  icon: LucideIcon;
  label: string;
  landingHref: string;
  children: SidebarItem[];
  /** The group's own landing page is reachable some other way, so don't offer
   *  an "Overview" row for it. */
  hideOverview?: boolean;
};

export type SidebarItem = SidebarLink | SidebarGroup;

export type SidebarSection = {
  label: string;
  items: SidebarItem[];
};

/**
 * Is `pathname` this link, or somewhere inside it?
 *
 * The `href !== "/"` guard matters: every path starts with "/", so without it
 * the dashboard link is permanently active and nothing else ever looks
 * selected.
 */
export function isLinkActive(href: string, pathname: string): boolean {
  if (href === pathname) return true;
  if (href === "/") return false;
  return pathname.startsWith(href + "/");
}

export function groupContainsActive(
  group: SidebarGroup,
  pathname: string
): boolean {
  if (pathname === group.landingHref) return true;
  return group.children.some((child) =>
    child.kind === "link"
      ? isLinkActive(child.href, pathname)
      : groupContainsActive(child, pathname)
  );
}

/**
 * Is the current route anywhere inside this section?
 *
 * Which is what decides whether a collapsible section starts open. Built from
 * the two helpers above so the desktop pane and the mobile drawer cannot
 * disagree about which section you are standing in.
 */
export function sectionContainsActive(
  section: SidebarSection,
  pathname: string
): boolean {
  return section.items.some((item) =>
    item.kind === "link"
      ? isLinkActive(item.href, pathname)
      : groupContainsActive(item, pathname)
  );
}

/** A leaf destination plus the category path that leads to it. */
export type FlatDestination = {
  href: string;
  label: string;
  icon: LucideIcon;
  /** ["Examinations", "Sheets & Prints"] — shown under a search result so the
   *  match is identifiable when two sections both have a "Results". */
  trail: string[];
};

export function flattenSections(
  sections: readonly SidebarSection[]
): FlatDestination[] {
  const out: FlatDestination[] = [];
  const seen = new Set<string>();

  const walk = (items: readonly SidebarItem[], trail: string[]) => {
    for (const item of items) {
      if (item.kind === "link") {
        // Hrefs can repeat across sections (the report shortcuts are the same
        // page with different query strings, and "Timetable" appears under
        // both Operations and Examinations). First one wins; a search result
        // list with the same row twice looks broken.
        if (seen.has(item.href)) continue;
        seen.add(item.href);
        out.push({
          href: item.href,
          label: item.label,
          icon: item.icon,
          trail,
        });
      } else {
        walk(item.children, [...trail, item.label]);
      }
    }
  };

  for (const section of sections) walk(section.items, [section.label]);
  return out;
}

/**
 * Every path the sidebar can reach, query strings stripped.
 *
 * Includes group landing pages, which `flattenSections` skips because they are
 * not leaves — /people is a real page with an "Overview" row pointing at it.
 * Query strings go because this is compared against `usePathname()`, which
 * never carries one: /reports/students?focus=fees and /reports/students are the
 * same screen as far as "am I on a destination?" is concerned.
 */
export function collectNavHrefs(
  sections: readonly SidebarSection[]
): Set<string> {
  const out = new Set<string>();
  const walk = (items: readonly SidebarItem[]) => {
    for (const item of items) {
      if (item.kind === "link") {
        out.add(item.href.split("?")[0]);
      } else {
        out.add(item.landingHref.split("?")[0]);
        walk(item.children);
      }
    }
  };
  for (const section of sections) walk(section.items);
  return out;
}

/**
 * Every token has to match somewhere in the label or its trail, so "exam
 * sheet" finds Examinations → Sheets & Prints → White Sheet without the user
 * having to guess which word the page actually calls itself.
 */
export function searchDestinations(
  destinations: readonly FlatDestination[],
  query: string
): FlatDestination[] {
  const tokens = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return [];

  const scored = destinations
    .map((d) => {
      const label = d.label.toLowerCase();
      const haystack = `${d.trail.join(" ")} ${d.label}`.toLowerCase();
      if (!tokens.every((t) => haystack.includes(t))) return null;
      // A hit in the destination's own name beats one that only matched its
      // category, and a name that starts with the query beats one that merely
      // contains it — typing "res" should surface Results, not every page
      // filed under it.
      const first = tokens[0];
      const rank = label.startsWith(first) ? 0 : label.includes(first) ? 1 : 2;
      return { d, rank };
    })
    .filter((x): x is { d: FlatDestination; rank: number } => x !== null);

  scored.sort((a, b) => a.rank - b.rank);
  return scored.map((x) => x.d);
}
