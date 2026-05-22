"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Settings2, ChevronRight } from "lucide-react";
import { createClient } from "@nkps/shared/lib/supabase/client";
import {
  FEATURE_CATALOG,
  type FeatureKey,
  type FeatureGroup,
} from "@nkps/shared/lib/permissions";
import { getCmsUrl, getErpUrl } from "@nkps/shared/lib/cross-app";
import { cn } from "@nkps/shared/lib/utils";
import { SidebarTooltip } from "@nkps/shared/components/SidebarTooltip";

// Where the user currently is. Drives which destinations the switcher offers
// (the current scope is hidden) and whether links use Next's <Link> or a
// cross-app <a>.
//   "erp-admin"  → apps/erp, admin route group ("/", "/people/...", etc.)
//   "erp-portal" → apps/erp, teacher portal ("/teacher/...")
//   "cms"        → apps/cms, all routes
export type AppScope = "erp-admin" | "erp-portal" | "cms";

type Destination = {
  key: "erp-admin" | "cms" | "teacher-portal";
  label: string;
  href: string;
  // True when the destination lives in a different Next.js app than the
  // caller and must navigate via a full-page <a href> instead of <Link>.
  external: boolean;
};

const FEATURE_GROUP_BY_KEY: Record<FeatureKey, FeatureGroup> = Object.fromEntries(
  FEATURE_CATALOG.map((f) => [f.key, f.group])
) as Record<FeatureKey, FeatureGroup>;

function currentApp(scope: AppScope): "erp" | "cms" {
  return scope === "cms" ? "cms" : "erp";
}

function buildDestinations(
  scope: AppScope,
  role: string | null,
  grantGroups: Set<FeatureGroup>
): Destination[] {
  const app = currentApp(scope);
  const items: Destination[] = [];

  // ERP Admin entry point.
  if (scope !== "erp-admin") {
    const allowed =
      role === "admin" ||
      role === "staff" ||
      (role === "teacher" && grantGroups.has("erp"));
    if (allowed) {
      items.push({
        key: "erp-admin",
        label: "ERP Admin",
        href: app === "erp" ? "/" : getErpUrl("/"),
        external: app !== "erp",
      });
    }
  }

  // CMS entry point.
  if (scope !== "cms") {
    const allowed =
      role === "admin" ||
      role === "staff" ||
      (role === "teacher" && grantGroups.has("cms"));
    if (allowed) {
      items.push({
        key: "cms",
        label: "CMS",
        href: app === "cms" ? "/" : getCmsUrl("/"),
        external: app !== "cms",
      });
    }
  }

  // Teacher portal — only relevant for teachers.
  if (scope !== "erp-portal" && role === "teacher") {
    items.push({
      key: "teacher-portal",
      label: "Teacher Portal",
      href: app === "erp" ? "/teacher" : getErpUrl("/teacher"),
      external: app !== "erp",
    });
  }

  return items;
}

// Sidebar footer entry for jumping between the apps a user has access to.
// Renders nothing while we're still loading the role/grants, and nothing if
// the user has no other place to go (e.g., a student or a teacher with zero
// grants on a non-teacher scope, which shouldn't happen via middleware).
export function AppSwitcher({
  scope,
  collapsed,
}: {
  scope: AppScope;
  collapsed: boolean;
}) {
  const [role, setRole] = useState<string | null>(null);
  const [grantGroups, setGrantGroups] = useState<Set<FeatureGroup> | null>(
    null
  );
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) {
        setRole(null);
        setGrantGroups(new Set());
        return;
      }
      supabase
        .from("profiles")
        .select("role")
        .eq("id", user.id)
        .single()
        .then(({ data }) => {
          setRole((data?.role as string | null) ?? null);
        });
      supabase
        .from("editor_permissions")
        .select("feature_key")
        .eq("editor_id", user.id)
        .then(({ data: rows }) => {
          const groups = new Set<FeatureGroup>();
          for (const r of rows ?? []) {
            const key = r.feature_key as FeatureKey | undefined;
            if (key && FEATURE_GROUP_BY_KEY[key]) {
              groups.add(FEATURE_GROUP_BY_KEY[key]);
            }
          }
          setGrantGroups(groups);
        });
    });
  }, []);

  if (role === null || grantGroups === null) return null;

  const destinations = buildDestinations(scope, role, grantGroups);
  if (destinations.length === 0) return null;

  // Single destination → render it as a flat link instead of a popover.
  if (destinations.length === 1) {
    const d = destinations[0]!;
    return (
      <SwitchLink
        href={d.href}
        label={`Switch to ${d.label}`}
        external={d.external}
        collapsed={collapsed}
      />
    );
  }

  // Multiple destinations → expandable popover.
  const button = (
    <button
      type="button"
      onClick={() => setOpen((v) => !v)}
      className={cn(
        "w-full flex items-center gap-3 rounded-lg text-sm transition-all duration-200 text-white/70 hover:bg-white/5 hover:text-white",
        collapsed ? "px-2.5 py-2.5 justify-center" : "px-3 py-2.5"
      )}
    >
      <Settings2 className="h-5 w-5 shrink-0" />
      {!collapsed && (
        <>
          <span className="truncate flex-1 text-left">Switch app</span>
          <ChevronRight
            className={cn(
              "h-4 w-4 shrink-0 transition-transform",
              open && "rotate-90"
            )}
          />
        </>
      )}
    </button>
  );

  return (
    <div className="px-2 pb-2">
      {collapsed ? (
        <SidebarTooltip label="Switch app">{button}</SidebarTooltip>
      ) : (
        button
      )}
      {open && !collapsed && (
        <div className="mt-1 ml-7 space-y-0.5 border-l border-white/10 pl-2">
          {destinations.map((d) =>
            d.external ? (
              <a
                key={d.key}
                href={d.href}
                rel="noopener"
                className="block px-3 py-2 text-xs rounded-md text-white/60 hover:bg-white/5 hover:text-white"
              >
                {d.label}
              </a>
            ) : (
              <Link
                key={d.key}
                href={d.href}
                className="block px-3 py-2 text-xs rounded-md text-white/60 hover:bg-white/5 hover:text-white"
              >
                {d.label}
              </Link>
            )
          )}
        </div>
      )}
    </div>
  );
}

function SwitchLink({
  href,
  label,
  external,
  collapsed,
}: {
  href: string;
  label: string;
  external: boolean;
  collapsed: boolean;
}) {
  const className = cn(
    "flex items-center gap-3 rounded-lg text-sm transition-all duration-200 text-white/70 hover:bg-white/5 hover:text-white",
    collapsed ? "px-2.5 py-2.5 justify-center" : "px-3 py-2.5"
  );
  const inner = (
    <>
      <Settings2 className="h-5 w-5 shrink-0" />
      {!collapsed && <span className="truncate">{label}</span>}
    </>
  );
  const link = external ? (
    <a href={href} className={className} rel="noopener">
      {inner}
    </a>
  ) : (
    <Link href={href} className={className}>
      {inner}
    </Link>
  );

  return (
    <div className="px-2 pb-2">
      {collapsed ? <SidebarTooltip label={label}>{link}</SidebarTooltip> : link}
    </div>
  );
}
