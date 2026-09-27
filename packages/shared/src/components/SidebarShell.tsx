"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { ChevronLeft, ChevronDown } from "lucide-react";
import { cn } from "@nkps/shared/lib/utils";
import { SidebarProfileMenu } from "@nkps/shared/components/SidebarProfileMenu";
import { SidebarTooltip } from "@nkps/shared/components/SidebarTooltip";
import { MobileNavDrawer } from "@nkps/shared/components/MobileNavDrawer";
import { useSidebar } from "@nkps/shared/components/providers/SidebarProvider";
import { useUnreadCount } from "@nkps/shared/hooks/useUnreadCount";
import {
  collectNavHrefs,
  groupContainsActive,
  isLinkActive,
  sectionContainsActive,
  type SidebarGroup,
  type SidebarItem,
  type SidebarLink,
  type SidebarSection,
} from "@nkps/shared/components/sidebar/nav";
import {
  useVisibleSections,
  type NavGate,
} from "@nkps/shared/components/sidebar/useVisibleSections";

// Re-exported so the five sidebars that declare nav trees keep importing their
// types from the component they hand them to.
export type {
  SidebarGroup,
  SidebarItem,
  SidebarLink,
  SidebarSection,
} from "@nkps/shared/components/sidebar/nav";

type SidebarShellProps = {
  sections: SidebarSection[];
  headerTitle: string;
  headerSubtitle: string;
  /**
   * "permissions" (default) filters links against the signed-in user's editor
   * grants. "none" is for the role portals, whose links are all reachable by
   * anyone the route gate let into the portal in the first place.
   */
  gate?: NavGate;
  // Hrefs always shown to staff/teachers regardless of their feature_key
  // permissions (typically the module dashboard, e.g. "/cms" or "/erp").
  editorAlwaysAllowedHrefs?: ReadonlySet<string>;
  // Where the profile menu's "Settings" link should land.
  settingsHref?: string;
  /** The module's dashboard — where the wordmark goes. */
  homeHref?: string;
  // Where to send the user after logout (module-specific login page).
  logoutRedirect?: string;
  // Hrefs for which the unread count badge should render
  // (passed in so each module can opt in to its own badges).
  unreadBadgeHrefs?: ReadonlySet<string>;
  pendingRegistrationBadgeHrefs?: ReadonlySet<string>;
  pendingFeeChangeRequestBadgeHrefs?: ReadonlySet<string>;
  pendingTransportChangeBadgeHrefs?: ReadonlySet<string>;
  // Optional slot rendered just above the profile menu — used to drop in an
  // app switcher so teachers/editors can jump back to their portal or to
  // another app they have access to.
  footerExtra?: React.ReactNode;
};

const NO_HREFS: ReadonlySet<string> = new Set();

export function SidebarShell({
  sections,
  headerTitle,
  headerSubtitle,
  gate = "permissions",
  editorAlwaysAllowedHrefs = NO_HREFS,
  settingsHref = "/portal/settings",
  homeHref = "/",
  logoutRedirect = "/portal/login",
  unreadBadgeHrefs,
  pendingRegistrationBadgeHrefs,
  pendingFeeChangeRequestBadgeHrefs,
  pendingTransportChangeBadgeHrefs,
  footerExtra,
}: SidebarShellProps) {
  const pathname = usePathname();
  const { collapsed, toggle, publishNavHrefs, publishHomeHref } = useSidebar();
  const {
    unreadCount,
    pendingRegistrationCount,
    pendingFeeChangeRequestCount,
    pendingTransportChangeCount,
  } = useUnreadCount({
    contact: !!unreadBadgeHrefs && unreadBadgeHrefs.size > 0,
    registrations:
      !!pendingRegistrationBadgeHrefs && pendingRegistrationBadgeHrefs.size > 0,
    feeChangeRequests:
      !!pendingFeeChangeRequestBadgeHrefs &&
      pendingFeeChangeRequestBadgeHrefs.size > 0,
    transportChanges:
      !!pendingTransportChangeBadgeHrefs &&
      pendingTransportChangeBadgeHrefs.size > 0,
  });

  // Role + grants come from the shell-wide session (see SessionProvider).
  const { sections: visibleSections, ready } = useVisibleSections({
    sections,
    gate,
    editorAlwaysAllowedHrefs,
  });

  const [groupOverrides, setGroupOverrides] = useState<Record<string, boolean>>(
    {}
  );
  const [sectionOverrides, setSectionOverrides] = useState<
    Record<string, boolean>
  >({});

  useEffect(() => {
    setGroupOverrides({});
    setSectionOverrides({});
  }, [pathname]);

  // Tell the app bar which paths are destinations, so it knows when to offer a
  // back arrow instead of the hamburger. Published from here rather than from
  // the drawer because the drawer only exists while it is open.
  const navHrefs = useMemo(
    () => collectNavHrefs(visibleSections),
    [visibleSections]
  );
  useEffect(() => {
    publishNavHrefs(navHrefs);
  }, [navHrefs, publishNavHrefs]);

  useEffect(() => {
    publishHomeHref(homeHref);
  }, [homeHref, publishHomeHref]);

  // One answer to "how many on this link?", shared with the drawer so the two
  // can't disagree and the counts are fetched once for both.
  const badgeFor = useCallback(
    (href: string): number =>
      unreadBadgeHrefs?.has(href) ? unreadCount
      : pendingRegistrationBadgeHrefs?.has(href) ? pendingRegistrationCount
      : pendingFeeChangeRequestBadgeHrefs?.has(href) ? pendingFeeChangeRequestCount
      : pendingTransportChangeBadgeHrefs?.has(href) ? pendingTransportChangeCount
      : 0,
    [
      unreadBadgeHrefs,
      pendingRegistrationBadgeHrefs,
      pendingFeeChangeRequestBadgeHrefs,
      pendingTransportChangeBadgeHrefs,
      unreadCount,
      pendingRegistrationCount,
      pendingFeeChangeRequestCount,
      pendingTransportChangeCount,
    ]
  );

  // Sections collapse, and start collapsed apart from the one holding the
  // current route — six categories over 54 destinations is a lot of pane to
  // read past when you already know where you are going. Only in the expanded
  // pane: the icon rail below has no section headers to click.
  const isSectionOpen = (section: SidebarSection): boolean =>
    section.label in sectionOverrides
      ? sectionOverrides[section.label]
      : sectionContainsActive(section, pathname);

  const toggleSection = (section: SidebarSection) =>
    setSectionOverrides((prev) => ({
      ...prev,
      [section.label]: !isSectionOpen(section),
    }));

  /** Badges of every descendant, for a section that is shut. */
  const sectionBadgeCount = (section: SidebarSection): number => {
    const walk = (items: readonly SidebarItem[]): number =>
      items.reduce(
        (sum, item) =>
          sum + (item.kind === "link" ? badgeFor(item.href) : walk(item.children)),
        0
      );
    return walk(section.items);
  };

  const isGroupOpen = (group: SidebarGroup): boolean =>
    group.label in groupOverrides
      ? groupOverrides[group.label]
      : groupContainsActive(group, pathname);

  const toggleGroup = (group: SidebarGroup) =>
    setGroupOverrides((prev) => ({ ...prev, [group.label]: !isGroupOpen(group) }));

  const renderLink = ({ icon: Icon, label, href }: SidebarLink) => {
    const isActive = isLinkActive(href, pathname);
    const badgeCount = badgeFor(href);
    const showBadge = badgeCount > 0;
    const badgeLabel = badgeCount > 99 ? "99+" : badgeCount;

    const linkContent = (
      <Link
        href={href}
        className={cn(
          "flex items-center gap-3 rounded-lg text-sm transition-all duration-200 relative",
          collapsed ? "px-2.5 py-2.5 justify-center" : "px-3 py-2.5",
          isActive
            ? "bg-white/10 text-white font-semibold border-l-[3px] border-gold-500"
            : "text-white/60 hover:bg-white/5 hover:text-white hover:translate-x-0.5"
        )}
      >
        <span className="relative">
          <Icon className="h-5 w-5 shrink-0" />
          {showBadge && collapsed && (
            <span className="absolute -top-1.5 -right-1.5 flex items-center justify-center bg-red-500 text-white text-[9px] font-bold rounded-full h-4 min-w-4 px-1">
              {badgeLabel}
            </span>
          )}
        </span>
        {!collapsed && (
          <>
            <span className="truncate">{label}</span>
            {showBadge && (
              <span className="ml-auto flex items-center justify-center bg-red-500 text-white text-[10px] font-bold rounded-full h-5 min-w-5 px-1.5">
                {badgeLabel}
              </span>
            )}
          </>
        )}
      </Link>
    );

    if (collapsed) {
      return (
        <SidebarTooltip key={href} label={showBadge ? `${label} (${badgeCount})` : label}>
          {linkContent}
        </SidebarTooltip>
      );
    }

    return <div key={href}>{linkContent}</div>;
  };

  const renderGroup = (group: SidebarGroup) => {
    const hasActiveDescendant = groupContainsActive(group, pathname);

    if (collapsed) {
      const iconContent = (
        <Link
          href={group.landingHref}
          className={cn(
            "flex items-center rounded-lg text-sm transition-all duration-200 px-2.5 py-2.5 justify-center",
            hasActiveDescendant
              ? "bg-white/10 text-white font-semibold border-l-[3px] border-gold-500"
              : "text-white/60 hover:bg-white/5 hover:text-white"
          )}
        >
          <group.icon className="h-5 w-5 shrink-0" />
        </Link>
      );
      return (
        <SidebarTooltip key={group.label} label={group.label}>
          {iconContent}
        </SidebarTooltip>
      );
    }

    const open = isGroupOpen(group);

    return (
      <div key={group.label}>
        <button
          type="button"
          onClick={() => toggleGroup(group)}
          aria-expanded={open}
          className={cn(
            "flex items-center gap-3 rounded-lg text-sm transition-all duration-200 w-full px-3 py-2.5",
            hasActiveDescendant
              ? "text-white font-semibold"
              : "text-white/60 hover:bg-white/5 hover:text-white hover:translate-x-0.5"
          )}
        >
          <group.icon className="h-5 w-5 shrink-0" />
          <span className="truncate flex-1 text-left">{group.label}</span>
          <ChevronDown
            className={cn(
              "h-4 w-4 shrink-0 transition-transform duration-200",
              !open && "-rotate-90"
            )}
          />
        </button>
        {open && (
          <div className="mt-0.5 ml-4 pl-3 border-l border-white/10 space-y-0.5">
            {!group.hideOverview && (
              <Link
                href={group.landingHref}
                className={cn(
                  "flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs transition-colors",
                  pathname === group.landingHref
                    ? "bg-white/10 text-white font-semibold"
                    : "text-white/50 hover:bg-white/5 hover:text-white"
                )}
              >
                <span className="truncate">Overview</span>
              </Link>
            )}
            {group.children.map((child) =>
              child.kind === "link"
                ? renderNestedLink(child)
                : renderNestedGroup(child)
            )}
          </div>
        )}
      </div>
    );
  };

  const renderNestedLink = (link: SidebarLink) => {
    const isActive = isLinkActive(link.href, pathname);
    const badgeCount = badgeFor(link.href);
    const showBadge = badgeCount > 0;
    const badgeLabel = badgeCount > 99 ? "99+" : badgeCount;
    return (
      <Link
        key={link.href}
        href={link.href}
        className={cn(
          "flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs transition-colors",
          isActive
            ? "bg-white/10 text-white font-semibold"
            : "text-white/50 hover:bg-white/5 hover:text-white"
        )}
      >
        <link.icon className="h-3.5 w-3.5 shrink-0" />
        <span className="truncate flex-1">{link.label}</span>
        {showBadge && (
          <span className="flex items-center justify-center bg-red-500 text-white text-[9px] font-bold rounded-full h-4 min-w-4 px-1">
            {badgeLabel}
          </span>
        )}
      </Link>
    );
  };

  const renderNestedGroup = (group: SidebarGroup) => {
    const open = isGroupOpen(group);
    const hasActiveDescendant = groupContainsActive(group, pathname);
    return (
      <div key={group.label}>
        <button
          type="button"
          onClick={() => toggleGroup(group)}
          aria-expanded={open}
          className={cn(
            "flex items-center gap-2 rounded-lg w-full px-3 py-1.5 text-xs transition-colors",
            hasActiveDescendant
              ? "text-white font-semibold"
              : "text-white/50 hover:bg-white/5 hover:text-white"
          )}
        >
          <group.icon className="h-3.5 w-3.5 shrink-0" />
          <span className="truncate flex-1 text-left">{group.label}</span>
          <ChevronDown
            className={cn(
              "h-3.5 w-3.5 shrink-0 transition-transform duration-200",
              !open && "-rotate-90"
            )}
          />
        </button>
        {open && (
          <div className="mt-0.5 ml-3 pl-3 border-l border-white/10 space-y-0.5">
            {!group.hideOverview && (
              <Link
                href={group.landingHref}
                className={cn(
                  "flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs transition-colors",
                  pathname === group.landingHref
                    ? "bg-white/10 text-white font-semibold"
                    : "text-white/50 hover:bg-white/5 hover:text-white"
                )}
              >
                <span className="truncate">Overview</span>
              </Link>
            )}
            {group.children.map((child) =>
              child.kind === "link"
                ? renderNestedLink(child)
                : renderNestedGroup(child)
            )}
          </div>
        )}
      </div>
    );
  };

  const renderItem = (item: SidebarItem) =>
    item.kind === "link" ? renderLink(item) : renderGroup(item);

  return (
    <>
      {/* Desktop pane. Below lg the drawer takes over entirely — this used to
          be the same element slid off-canvas, which is why a phone was getting
          a 264px desktop rail with hover affordances and no gesture. */}
      <aside
        data-app-chrome
        className={cn(
          "fixed left-0 top-0 h-screen bg-navy-900 hidden lg:flex flex-col z-40 transition-all duration-300 ease-in-out",
          collapsed ? "lg:w-[72px]" : "lg:w-64"
        )}
      >
        {/* Header */}
        <div className={cn("p-4 flex items-center", collapsed ? "justify-center" : "gap-3 px-6")}>
          {collapsed && (
            <Link href={homeHref} aria-label="Dashboard" className="transition-opacity hover:opacity-80">
              <Image
                src="/images/logo.png"
                alt=""
                width={32}
                height={32}
                className="rounded-full"
              />
            </Link>
          )}
          {!collapsed && (
            <>
              <Link
                href={homeHref}
                className="flex min-w-0 flex-1 items-center gap-3 rounded-lg transition-opacity hover:opacity-80"
              >
                <Image
                  src="/images/logo.png"
                  alt=""
                  width={36}
                  height={36}
                  className="rounded-full shrink-0"
                />
                <div className="min-w-0 flex-1">
                  <h1 className="font-heading text-xl font-bold text-white truncate">
                    {headerTitle}
                  </h1>
                  <p className="text-sm text-gold-500 mt-0.5">{headerSubtitle}</p>
                </div>
              </Link>
              <button
                onClick={toggle}
                className="flex items-center justify-center h-7 w-7 rounded-lg text-white/40 hover:bg-white/5 hover:text-white transition-colors shrink-0"
                title="Collapse sidebar"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
            </>
          )}
          {collapsed && (
            <button
              onClick={toggle}
              className="flex items-center justify-center h-8 w-8 rounded-lg hover:bg-white/5 transition-colors"
              title="Expand sidebar"
            >
              <Image
                src="/images/logo.png"
                alt="NKPS Logo"
                width={32}
                height={32}
                className="rounded-full"
              />
            </button>
          )}
        </div>

        {!collapsed && (
          <div className="px-6 mb-2">
            <div className="h-0.5 w-12 bg-gold-500 rounded-full" />
          </div>
        )}

        {/* Navigation */}
        <nav className="flex-1 min-h-0 px-2 overflow-y-auto">
          {visibleSections.map((section, idx) => {
            if (section.items.length === 0) return null;
            // The rail has no headers, so nothing to collapse and nothing to
            // label — it keeps showing every icon, as before.
            const open = collapsed || isSectionOpen(section);
            const rolledUp = sectionBadgeCount(section);
            return (
              <div key={section.label} className={cn(idx === 0 ? "mb-1" : "mt-1 pb-1")}>
                {!collapsed && (
                  <button
                    type="button"
                    onClick={() => toggleSection(section)}
                    aria-expanded={open}
                    className="flex w-full items-center gap-2 rounded-lg px-3 py-1.5 mb-0.5 text-[10px] font-semibold uppercase tracking-wider text-white/40 transition-colors hover:bg-white/5 hover:text-white/70"
                  >
                    <span className="flex-1 text-left">{section.label}</span>
                    {!open && rolledUp > 0 && (
                      <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[9px] font-bold text-white">
                        {rolledUp > 99 ? "99+" : rolledUp}
                      </span>
                    )}
                    <ChevronDown
                      className={cn(
                        "h-3 w-3 shrink-0 transition-transform duration-200",
                        !open && "-rotate-90"
                      )}
                    />
                  </button>
                )}
                {collapsed && idx > 0 && <div className="h-px bg-white/10 mx-2 mb-2 mt-3" />}
                {collapsed && idx === 0 && <div className="h-px bg-white/10 mx-2 mb-2" />}
                {open && (
                  <div className="space-y-0.5">
                    {section.items.map(renderItem)}
                  </div>
                )}
              </div>
            );
          })}
        </nav>

        {footerExtra}
        <SidebarProfileMenu
          settingsHref={settingsHref}
          logoutRedirect={logoutRedirect}
          collapsed={collapsed}
        />
      </aside>

      <MobileNavDrawer
        sections={visibleSections}
        ready={ready}
        headerTitle={headerTitle}
        headerSubtitle={headerSubtitle}
        homeHref={homeHref}
        settingsHref={settingsHref}
        logoutRedirect={logoutRedirect}
        badgeFor={badgeFor}
        footerExtra={footerExtra}
      />
    </>
  );
}
