"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { createClient } from "@nkps/shared/lib/supabase/client";
import type { UserRole } from "@nkps/shared/types";
import { FEATURE_CATALOG, type FeatureKey } from "@nkps/shared/lib/permissions";
import {
  ChevronLeft,
  ChevronDown,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@nkps/shared/lib/utils";
import { SidebarProfileMenu } from "@nkps/shared/components/SidebarProfileMenu";
import { SidebarTooltip } from "@nkps/shared/components/SidebarTooltip";
import { useSidebar } from "@nkps/shared/components/providers/SidebarProvider";
import { useUnreadCount } from "@nkps/shared/hooks/useUnreadCount";

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
  hideOverview?: boolean;
};

export type SidebarItem = SidebarLink | SidebarGroup;

export type SidebarSection = {
  label: string;
  items: SidebarItem[];
};

type SidebarShellProps = {
  sections: SidebarSection[];
  headerTitle: string;
  headerSubtitle: string;
  // Hrefs always shown to staff/teachers regardless of their feature_key
  // permissions (typically the module dashboard, e.g. "/cms" or "/erp").
  editorAlwaysAllowedHrefs: ReadonlySet<string>;
  // Where the profile menu's "Settings" link should land.
  settingsHref?: string;
  // Where to send the user after logout (module-specific login page).
  logoutRedirect?: string;
  // Hrefs for which the unread count badge should render
  // (passed in so each module can opt in to its own badges).
  unreadBadgeHrefs?: ReadonlySet<string>;
  pendingRegistrationBadgeHrefs?: ReadonlySet<string>;
  pendingFeeChangeRequestBadgeHrefs?: ReadonlySet<string>;
  // Optional slot rendered just above the profile menu — used to drop in an
  // app switcher so teachers/editors can jump back to their portal or to
  // another app they have access to.
  footerExtra?: React.ReactNode;
};

// Exact-href lookup covers most sidebar items. Sub-routes that fall under
// a feature umbrella (e.g. /fees/academic, /fees/transport) aren't in the
// catalog by themselves — we resolve those by longest-prefix match so the
// whole tree is gated by a single feature key.
const HREF_TO_FEATURE_KEY: Record<string, FeatureKey> = Object.fromEntries(
  FEATURE_CATALOG.map((f) => [f.href, f.key])
);
const FEATURE_HREFS_DESC = [...FEATURE_CATALOG].sort(
  (a, b) => b.href.length - a.href.length
);
function resolveFeatureKey(href: string): FeatureKey | null {
  const direct = HREF_TO_FEATURE_KEY[href];
  if (direct) return direct;
  for (const f of FEATURE_HREFS_DESC) {
    if (href === f.href || href.startsWith(`${f.href}/`)) return f.key;
  }
  return null;
}

export function SidebarShell({
  sections,
  headerTitle,
  headerSubtitle,
  editorAlwaysAllowedHrefs,
  settingsHref = "/portal/settings",
  logoutRedirect,
  unreadBadgeHrefs,
  pendingRegistrationBadgeHrefs,
  pendingFeeChangeRequestBadgeHrefs,
  footerExtra,
}: SidebarShellProps) {
  const pathname = usePathname();
  const { collapsed, toggle } = useSidebar();
  const { unreadCount, pendingRegistrationCount, pendingFeeChangeRequestCount } =
    useUnreadCount({
      contact: !!unreadBadgeHrefs && unreadBadgeHrefs.size > 0,
      registrations:
        !!pendingRegistrationBadgeHrefs &&
        pendingRegistrationBadgeHrefs.size > 0,
      feeChangeRequests:
        !!pendingFeeChangeRequestBadgeHrefs &&
        pendingFeeChangeRequestBadgeHrefs.size > 0,
    });
  const [userRole, setUserRole] = useState<UserRole>("admin");
  const [permissions, setPermissions] = useState<Set<FeatureKey> | null>(null);
  const [groupOverrides, setGroupOverrides] = useState<Record<string, boolean>>(
    {}
  );

  useEffect(() => {
    setGroupOverrides({});
  }, [pathname]);

  const groupContainsActive = (group: SidebarGroup): boolean => {
    if (pathname === group.landingHref) return true;
    return group.children.some((child) => {
      if (child.kind === "link") {
        return pathname === child.href || pathname.startsWith(child.href + "/");
      }
      return groupContainsActive(child);
    });
  };

  const isGroupOpen = (group: SidebarGroup): boolean => {
    if (group.label in groupOverrides) {
      return groupOverrides[group.label];
    }
    return groupContainsActive(group);
  };

  const toggleGroup = (group: SidebarGroup) => {
    const currentlyOpen = isGroupOpen(group);
    setGroupOverrides((prev) => ({ ...prev, [group.label]: !currentlyOpen }));
  };

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) return;
      supabase
        .from("profiles")
        .select("role")
        .eq("id", user.id)
        .single()
        .then(({ data }) => {
          if (!data?.role) return;
          const role = data.role as UserRole;
          setUserRole(role);
          // Admins skip the lookup — they always see everything. Staff and
          // teachers may hold editor capability via editor_permissions rows;
          // students/parents never reach this shell.
          if (role === "admin") {
            setPermissions(new Set());
            return;
          }
          supabase
            .from("editor_permissions")
            .select("feature_key")
            .eq("editor_id", user.id)
            .then(({ data: rows }) => {
              const keys = new Set<FeatureKey>(
                (rows ?? []).map((r) => r.feature_key as FeatureKey)
              );
              setPermissions(keys);
            });
        });
    });
  }, []);

  const isAdmin = userRole === "admin";

  const isCapabilityAllowed = (href: string): boolean => {
    if (editorAlwaysAllowedHrefs.has(href)) return true;
    const key = resolveFeatureKey(href);
    if (!key) return false;
    return permissions?.has(key) ?? false;
  };

  // Hide everything until permissions load (for non-admins) to avoid flash of
  // forbidden links.
  const permissionsReady = isAdmin || permissions !== null;

  const filterItem = (item: SidebarItem): SidebarItem | null => {
    if (item.kind === "link") {
      return !isAdmin && !isCapabilityAllowed(item.href) ? null : item;
    }
    const visibleChildren = item.children
      .map(filterItem)
      .filter((c): c is SidebarItem => c !== null);
    if (visibleChildren.length === 0) return null;
    return { ...item, children: visibleChildren };
  };

  const visibleSections = !permissionsReady
    ? sections.map((s) => ({ ...s, items: [] as SidebarItem[] }))
    : sections.map((s) => ({
        ...s,
        items: s.items
          .map(filterItem)
          .filter((x): x is SidebarItem => x !== null),
      }));

  const renderLink = ({ icon: Icon, label, href }: SidebarLink) => {
    const isActive =
      href === pathname ||
      (href !== "/" && pathname.startsWith(href + "/"));

    const badgeCount =
      unreadBadgeHrefs?.has(href) ? unreadCount
      : pendingRegistrationBadgeHrefs?.has(href) ? pendingRegistrationCount
      : pendingFeeChangeRequestBadgeHrefs?.has(href) ? pendingFeeChangeRequestCount
      : 0;
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
    const hasActiveDescendant = groupContainsActive(group);

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
    const isActive =
      pathname === link.href || pathname.startsWith(link.href + "/");
    const badgeCount =
      unreadBadgeHrefs?.has(link.href) ? unreadCount
      : pendingRegistrationBadgeHrefs?.has(link.href) ? pendingRegistrationCount
      : pendingFeeChangeRequestBadgeHrefs?.has(link.href) ? pendingFeeChangeRequestCount
      : 0;
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
    const hasActiveDescendant = groupContainsActive(group);
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
    <aside
      className={cn(
        "fixed left-0 top-0 h-screen bg-navy-900 flex flex-col z-40 transition-all duration-300 ease-in-out",
        collapsed ? "w-[72px]" : "w-64"
      )}
    >
      {/* Header */}
      <div className={cn("p-4 flex items-center", collapsed ? "justify-center" : "gap-3 px-6")}>
        {!collapsed && (
          <>
            <Image
              src="/images/logo.png"
              alt="NKPS Logo"
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
        {visibleSections.map((section, idx) =>
          section.items.length === 0 ? null : (
            <div key={section.label} className={cn(idx === 0 ? "mb-1" : "mt-4 pb-2")}>
              {!collapsed && (
                <p className="px-3 mb-1 text-[10px] font-semibold uppercase tracking-wider text-white/40">
                  {section.label}
                </p>
              )}
              {collapsed && idx > 0 && <div className="h-px bg-white/10 mx-2 mb-2 mt-3" />}
              {collapsed && idx === 0 && <div className="h-px bg-white/10 mx-2 mb-2" />}
              <div className="space-y-0.5">
                {section.items.map(renderItem)}
              </div>
            </div>
          )
        )}
      </nav>

      {footerExtra}
      <SidebarProfileMenu
        settingsHref={settingsHref}
        logoutRedirect={logoutRedirect}
        collapsed={collapsed}
      />
    </aside>
  );
}
