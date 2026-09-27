"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import {
  AnimatePresence,
  motion,
  useMotionValue,
  useTransform,
  type PanInfo,
} from "framer-motion";
import { ChevronDown, Lock, LogOut, Search, Settings, X } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@nkps/shared/lib/utils";
import { createClient } from "@nkps/shared/lib/supabase/client";
import { useSidebar } from "@nkps/shared/components/providers/SidebarProvider";
import { useSession } from "@nkps/shared/components/providers/SessionProvider";
import { ThemeToggle } from "@nkps/shared/components/ThemeToggle";
import { useAppLock } from "@nkps/shared/components/security/AppLockProvider";
import {
  flattenSections,
  groupContainsActive,
  isLinkActive,
  searchDestinations,
  sectionContainsActive,
  type SidebarGroup,
  type SidebarItem,
  type SidebarSection,
} from "@nkps/shared/components/sidebar/nav";

// The navigation drawer for phones and small tablets.
//
// It is a different component from the desktop pane rather than the same one
// slid sideways, which is what it used to be: a 264px desktop rail with
// `-translate-x-full` on it. That gave a phone 40px rows, hover-only
// affordances, a CSS transition with no gesture behind it, no focus trap, and —
// in an ERP with sixty destinations — a flat scroll with no way to search.
//
// What it does differently:
//   - drag-to-close with velocity, and a backdrop that fades with the drag, so
//     the sheet tracks the thumb instead of animating on a timer.
//   - search across every destination, flattened, each result labelled with the
//     category path that leads to it. On a screen this size that is the fastest
//     route to a deep page by a wide margin.
//   - 48px rows, h-dvh (h-screen is taller than the visible viewport when
//     mobile browser chrome is showing, which pushes the footer off-screen),
//     and safe-area padding top and bottom.
//   - the things you actually reach for from a drawer — theme, settings, sign
//     out — in the footer rather than behind a second popover.

const PANEL_MAX_PX = 352;
const CLOSE_OFFSET_PX = 60;
const CLOSE_VELOCITY = 400;

type BadgeLookup = (href: string) => number;

export interface MobileNavDrawerProps {
  sections: readonly SidebarSection[];
  /** False while grants are still resolving; the list renders empty. */
  ready: boolean;
  headerTitle: string;
  headerSubtitle: string;
  homeHref: string;
  settingsHref: string;
  logoutRedirect: string;
  badgeFor: BadgeLookup;
  footerExtra?: React.ReactNode;
}

function Badge({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <span className="ml-auto flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-red-500 px-1.5 text-[10px] font-bold text-white">
      {count > 99 ? "99+" : count}
    </span>
  );
}

export function MobileNavDrawer({
  sections,
  ready,
  headerTitle,
  headerSubtitle,
  homeHref,
  settingsHref,
  logoutRedirect,
  badgeFor,
  footerExtra,
}: MobileNavDrawerProps) {
  const pathname = usePathname();
  const { mobileOpen, closeMobile } = useSidebar();
  const { profile } = useSession();
  const { settings: lockSettings, lock } = useAppLock();
  const panelRef = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState("");
  const [overrides, setOverrides] = useState<Record<string, boolean>>({});
  const [sectionOverrides, setSectionOverrides] = useState<
    Record<string, boolean>
  >({});
  const [mounted, setMounted] = useState(false);

  const x = useMotionValue(0);
  // The backdrop lightens as the panel is dragged away, so the gesture reads as
  // one movement rather than a panel sliding under a static grey sheet.
  const backdropOpacity = useTransform(x, [-PANEL_MAX_PX, 0], [0, 1]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMounted(true);
  }, []);

  // Every open starts clean: yesterday's search text and hand-collapsed
  // sections are not state anyone expects a drawer to remember.
  useEffect(() => {
    if (!mobileOpen) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setQuery("");
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setOverrides({});
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSectionOverrides({});
    x.set(0);
  }, [mobileOpen, x]);

  const destinations = useMemo(() => flattenSections(sections), [sections]);
  const results = useMemo(
    () => searchDestinations(destinations, query),
    [destinations, query]
  );
  const searching = query.trim().length > 0;

  const isGroupOpen = useCallback(
    (group: SidebarGroup) =>
      group.label in overrides
        ? overrides[group.label]
        : groupContainsActive(group, pathname),
    [overrides, pathname]
  );

  const toggleGroup = (group: SidebarGroup) =>
    setOverrides((prev) => ({ ...prev, [group.label]: !isGroupOpen(group) }));

  // Sections collapse too, and start collapsed apart from the one you are
  // standing in. Six categories holding 54 destinations meant opening the
  // drawer put ~2,600px of scroll in front of someone looking for one link;
  // categorising them made that navigable but not short.
  const isSectionOpen = useCallback(
    (section: SidebarSection) =>
      section.label in sectionOverrides
        ? sectionOverrides[section.label]
        : sectionContainsActive(section, pathname),
    [sectionOverrides, pathname]
  );

  const toggleSection = (section: SidebarSection) =>
    setSectionOverrides((prev) => ({
      ...prev,
      [section.label]: !isSectionOpen(section),
    }));

  /** Badges of every descendant, for a section that is shut. */
  const sectionBadgeCount = useCallback(
    (section: SidebarSection): number => {
      const walk = (items: readonly SidebarItem[]): number =>
        items.reduce(
          (sum, item) =>
            sum +
            (item.kind === "link" ? badgeFor(item.href) : walk(item.children)),
          0
        );
      return walk(section.items);
    },
    [badgeFor]
  );

  const handleDragEnd = (_: unknown, info: PanInfo) => {
    if (info.offset.x < -CLOSE_OFFSET_PX || info.velocity.x < -CLOSE_VELOCITY) {
      closeMobile();
    } else {
      x.set(0);
    }
  };

  const handleLogout = async () => {
    const supabase = createClient();
    await supabase.auth.signOut();
    document.cookie = "x-user-role=; path=/; max-age=0";
    toast.success("Logged out");
    // Hard navigation so middleware runs fresh against a cleared session.
    window.location.href = logoutRedirect;
  };

  // Escape closes; Tab is kept inside the panel. A drawer that covers the page
  // but leaves focus behind it is unusable with a keyboard and invisible to a
  // screen reader, which is where the old one was.
  useEffect(() => {
    if (!mobileOpen) return;
    const panel = panelRef.current;
    if (!panel) return;

    const previouslyFocused = document.activeElement as HTMLElement | null;
    panel.focus({ preventScroll: true });

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        closeMobile();
        return;
      }
      if (e.key !== "Tab") return;
      const focusable = panel.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])'
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      previouslyFocused?.focus?.();
    };
  }, [mobileOpen, closeMobile]);

  const renderRow = (
    item: Extract<SidebarItem, { kind: "link" }>,
    depth: number
  ) => {
    const active = isLinkActive(item.href, pathname);
    return (
      <Link
        key={item.href}
        href={item.href}
        className={cn(
          // min-h-12 rather than a fixed height: a two-line label ("Subjects &
          // Assignments" wraps at this width) must grow the row, not overflow.
          "flex min-h-12 items-center gap-3 rounded-xl px-3 text-[15px] transition-colors",
          depth > 0 && "ml-3",
          active
            ? "bg-gold-500/15 font-semibold text-white"
            : "text-white/70 active:bg-white/10"
        )}
      >
        <item.icon className="h-5 w-5 shrink-0" />
        <span className="min-w-0 flex-1 leading-tight">{item.label}</span>
        <Badge count={badgeFor(item.href)} />
      </Link>
    );
  };

  const renderItem = (item: SidebarItem, depth = 0): React.ReactNode => {
    if (item.kind === "link") return renderRow(item, depth);

    const open = isGroupOpen(item);
    const active = groupContainsActive(item, pathname);
    // A collapsed group hides its children's badges, so roll them up onto the
    // group header — otherwise the only sign that something needs attention is
    // behind a tap.
    const rolledUp = item.children.reduce(
      (sum, child) => sum + (child.kind === "link" ? badgeFor(child.href) : 0),
      0
    );

    return (
      <div key={item.label}>
        <button
          type="button"
          onClick={() => toggleGroup(item)}
          aria-expanded={open}
          className={cn(
            "flex min-h-12 w-full items-center gap-3 rounded-xl px-3 text-[15px] transition-colors",
            depth > 0 && "ml-3",
            active ? "font-semibold text-white" : "text-white/70 active:bg-white/10"
          )}
        >
          <item.icon className="h-5 w-5 shrink-0" />
          <span className="min-w-0 flex-1 text-left leading-tight">
            {item.label}
          </span>
          {!open && <Badge count={rolledUp} />}
          <ChevronDown
            className={cn(
              "h-4 w-4 shrink-0 text-white/40 transition-transform duration-200",
              !open && "-rotate-90"
            )}
          />
        </button>
        {open && (
          <div className="mt-0.5 ml-6 space-y-0.5 border-l border-white/10 pl-2">
            {!item.hideOverview && (
              <Link
                href={item.landingHref}
                className={cn(
                  "flex min-h-11 items-center rounded-xl px-3 text-sm transition-colors",
                  pathname === item.landingHref
                    ? "bg-gold-500/15 font-semibold text-white"
                    : "text-white/50 active:bg-white/10"
                )}
              >
                Overview
              </Link>
            )}
            {item.children.map((child) => renderItem(child, depth + 1))}
          </div>
        )}
      </div>
    );
  };

  if (!mounted) return null;

  const initials = profile?.full_name
    ? profile.full_name
        .split(" ")
        .slice(0, 2)
        .map((n) => n[0])
        .join("")
        .toUpperCase()
    : "?";

  // Portalled to <body>: the drawer has to sit above the sticky app bar and
  // anything a page has pinned of its own (the guide launcher is z-40), and
  // inside the shell it would be competing with their stacking contexts.
  return createPortal(
    <AnimatePresence>
      {mobileOpen && (
        <div className="lg:hidden" data-app-chrome>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={closeMobile}
            aria-hidden
            className="fixed inset-0 z-40 bg-black/60"
            style={{ opacity: backdropOpacity }}
          />

          <motion.div
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-label="Navigation"
            tabIndex={-1}
            initial={{ x: "-100%" }}
            animate={{ x: 0 }}
            exit={{ x: "-100%" }}
            transition={{ type: "spring", stiffness: 420, damping: 40 }}
            drag="x"
            dragConstraints={{ left: -PANEL_MAX_PX, right: 0 }}
            dragElastic={{ left: 0.1, right: 0 }}
            dragMomentum={false}
            onDragEnd={handleDragEnd}
            style={{ x }}
            className="fixed inset-y-0 left-0 z-50 flex h-dvh w-[86vw] max-w-[22rem] flex-col bg-navy-900 shadow-2xl outline-none"
          >
            {/* Header */}
            <div className="app-safe-t shrink-0 border-b border-white/10">
              <div className="flex items-center gap-3 px-4 py-3">
                <Link
                  href={homeHref}
                  className="flex min-w-0 flex-1 items-center gap-3 rounded-lg transition-opacity hover:opacity-80"
                >
                  <Image
                    src="/images/logo.png"
                    alt=""
                    width={36}
                    height={36}
                    className="shrink-0 rounded-full"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-heading text-lg font-bold text-white">
                      {headerTitle}
                    </p>
                    <p className="text-xs text-gold-500">{headerSubtitle}</p>
                  </div>
                </Link>
                <button
                  type="button"
                  onClick={closeMobile}
                  aria-label="Close menu"
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-white/60 active:bg-white/10"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>

              <div className="px-4 pb-3">
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/40" />
                  <input /* mobile-layout-ok: borderless inside its own styled container; sized above */
                    type="search"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Search pages…"
                    aria-label="Search pages"
                    // text-base, not text-sm: iOS zooms the whole viewport when
                    // a focused input's font is under 16px, and it does not
                    // zoom back out afterwards.
                    className="h-11 w-full rounded-xl border border-white/10 bg-white/5 pl-9 pr-3 text-base text-white placeholder:text-white/40 focus:border-gold-500/60 focus:outline-none"
                  />
                </div>
              </div>
            </div>

            {/* Destinations */}
            <nav className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 py-3">
              {!ready ? null : searching ? (
                results.length === 0 ? (
                  <p className="px-3 py-8 text-center text-sm text-white/40">
                    Nothing matches “{query.trim()}”.
                  </p>
                ) : (
                  <div className="space-y-0.5">
                    {results.map((r) => (
                      <Link
                        key={r.href}
                        href={r.href}
                        className="flex min-h-12 items-center gap-3 rounded-xl px-3 text-[15px] text-white/80 transition-colors active:bg-white/10"
                      >
                        <r.icon className="h-5 w-5 shrink-0" />
                        <span className="min-w-0 flex-1 leading-tight">
                          <span className="block truncate">{r.label}</span>
                          <span className="block truncate text-[11px] text-white/40">
                            {r.trail.join(" › ")}
                          </span>
                        </span>
                        <Badge count={badgeFor(r.href)} />
                      </Link>
                    ))}
                  </div>
                )
              ) : (
                sections.map((section) => {
                  if (section.items.length === 0) return null;
                  const open = isSectionOpen(section);
                  const rolledUp = sectionBadgeCount(section);
                  return (
                    <div key={section.label} className="mb-2 last:mb-0">
                      <button
                        type="button"
                        onClick={() => toggleSection(section)}
                        aria-expanded={open}
                        className="flex min-h-11 w-full items-center gap-2 rounded-xl px-3 text-[11px] font-semibold uppercase tracking-wider text-white/50 transition-colors active:bg-white/10"
                      >
                        <span className="flex-1 text-left">{section.label}</span>
                        {/* A shut section must not swallow the reason to open
                            it, so its descendants' badges surface here. */}
                        {!open && <Badge count={rolledUp} />}
                        <ChevronDown
                          className={cn(
                            "h-3.5 w-3.5 shrink-0 transition-transform duration-200",
                            !open && "-rotate-90"
                          )}
                        />
                      </button>
                      {open && (
                        <div className="mt-0.5 space-y-0.5">
                          {section.items.map((item) => renderItem(item))}
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </nav>

            {/* Footer */}
            <div className="app-safe-b shrink-0 border-t border-white/10 bg-navy-900">
              {footerExtra}
              <div className="px-3 pt-3">
                <ThemeToggle tone="sidebar" />
              </div>
              {/* Only offered when App Lock is on — a "Lock now" that does
                  nothing because the feature is off is worse than no button. */}
              {lockSettings.enabled && (
                <button
                  type="button"
                  onClick={() => {
                    closeMobile();
                    lock();
                  }}
                  className="mx-3 mt-2 flex min-h-11 w-[calc(100%-1.5rem)] items-center gap-3 rounded-xl px-3 text-sm text-white/70 active:bg-white/10"
                >
                  <Lock className="h-4 w-4 shrink-0" />
                  Lock now
                </button>
              )}
              <div className="flex items-center gap-2 px-3 py-3">
                <Link
                  href={settingsHref}
                  className="flex min-h-12 flex-1 items-center gap-3 rounded-xl px-3 text-sm text-white/70 active:bg-white/10"
                >
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-full bg-white/10 text-xs font-bold text-white">
                    {profile?.avatar_url ? (
                      <Image
                        src={profile.avatar_url}
                        alt=""
                        width={32}
                        height={32}
                        className="h-8 w-8 object-cover"
                      />
                    ) : (
                      initials
                    )}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium text-white">
                      {profile?.full_name ?? "Settings"}
                    </span>
                    <span className="block truncate text-[11px] capitalize text-white/40">
                      {profile?.role ?? "Account"}
                    </span>
                  </span>
                  <Settings className="h-4 w-4 shrink-0 text-white/40" />
                </Link>
                <button
                  type="button"
                  onClick={handleLogout}
                  aria-label="Sign out"
                  className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl text-red-400 active:bg-red-500/10"
                >
                  <LogOut className="h-5 w-5" />
                </button>
              </div>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body
  );
}
