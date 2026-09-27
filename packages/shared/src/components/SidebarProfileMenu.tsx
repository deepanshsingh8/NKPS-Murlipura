"use client";

import { useEffect, useState, useRef } from "react";
import Image from "next/image";
import Link from "next/link";
import { createClient } from "@nkps/shared/lib/supabase/client";
import { Settings, LogOut, ChevronUp, ExternalLink, Lock } from "lucide-react";
import { cn } from "@nkps/shared/lib/utils";
import { getWebsiteUrl } from "@nkps/shared/lib/cross-app";
import { useSession } from "@nkps/shared/components/providers/SessionProvider";
import { ThemeToggle } from "@nkps/shared/components/ThemeToggle";
import { useAppLock } from "@nkps/shared/components/security/AppLockProvider";
import { toast } from "sonner";

export function SidebarProfileMenu({
  settingsHref,
  logoutRedirect = "/portal/login",
  collapsed = false,
}: {
  settingsHref: string;
  logoutRedirect?: string;
  collapsed?: boolean;
}) {
  // Shared with the sidebar, the app switcher and useIsAdmin — see
  // SessionProvider. This used to be its own getUser() -> profiles pair.
  const { profile } = useSession();
  const { settings: lockSettings, lock } = useAppLock();
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Close on outside press, or Escape.
  //
  // `pointerdown` rather than `mousedown`: touch devices only synthesise a
  // mouse event after the gesture resolves, so on a phone the menu stayed open
  // through the first tap outside it. Escape had no handler at all.
  useEffect(() => {
    if (!open) return;
    function handlePress(e: Event) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("pointerdown", handlePress);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("pointerdown", handlePress);
      document.removeEventListener("keydown", handleKey);
    };
  }, [open]);

  const handleLogout = async () => {
    const supabase = createClient();
    await supabase.auth.signOut();
    document.cookie = "x-user-role=; path=/; max-age=0";
    toast.success("Logged out");
    // Hard navigation ensures middleware runs fresh with cleared session
    window.location.href = logoutRedirect;
  };

  const initials = profile?.full_name
    ? profile.full_name
        .split(" ")
        .slice(0, 2)
        .map((n) => n[0])
        .join("")
        .toUpperCase()
    : "?";

  return (
    <div ref={menuRef} className={cn("relative border-t border-white/10", collapsed ? "p-2" : "p-3")}>
      {/* Popover menu */}
      {open && (
        <div
          className={cn(
            "absolute bottom-full mb-2 bg-navy-800 rounded-xl border border-white/10 shadow-xl overflow-hidden animate-in fade-in slide-in-from-bottom-2 duration-150",
            // w-60, not w-48: the theme control holds three labelled options
            // and "System" was being clipped in the narrower menu.
            collapsed ? "left-1 w-60" : "left-3 right-3"
          )}
        >
          {/* User info in popover when collapsed */}
          {collapsed && profile && (
            <div className="px-4 py-3 border-b border-white/10">
              <p className="text-sm font-medium text-white truncate">
                {profile.full_name}
              </p>
              <p className="text-[11px] text-white/40 capitalize">{profile.role}</p>
            </div>
          )}
          {/* Theme sits in the menu, not only in Settings: it is the one
              preference people change on a whim — walking outside, turning the
              lights off — and making that a two-page trip is how a toggle goes
              unused. Settings keeps its own copy of the same control. */}
          <div className="px-3 pt-3 pb-2">
            <p className="px-1 pb-1.5 text-[10px] font-semibold uppercase tracking-wider text-white/40">
              Theme
            </p>
            <ThemeToggle tone="sidebar" />
          </div>
          <div className="border-t border-white/10" />
          <Link
            href={settingsHref}
            onClick={() => setOpen(false)}
            className="flex items-center gap-3 px-4 py-3 text-sm text-white/70 hover:bg-white/5 hover:text-white transition-colors"
          >
            <Settings className="h-4 w-4" />
            Settings
          </Link>
          {lockSettings.enabled && (
            <button
              onClick={() => {
                setOpen(false);
                lock();
              }}
              className="flex w-full items-center gap-3 px-4 py-3 text-sm text-white/70 hover:bg-white/5 hover:text-white transition-colors"
            >
              <Lock className="h-4 w-4" />
              Lock now
            </button>
          )}
          <Link
            href={getWebsiteUrl("/")}
            onClick={() => setOpen(false)}
            className="flex items-center gap-3 px-4 py-3 text-sm text-white/70 hover:bg-white/5 hover:text-white transition-colors"
          >
            <ExternalLink className="h-4 w-4" />
            Back to Website
          </Link>
          <div className="border-t border-white/10" />
          <button
            onClick={handleLogout}
            className="flex items-center gap-3 px-4 py-3 text-sm text-red-400 hover:bg-red-500/10 hover:text-red-300 transition-colors w-full"
          >
            <LogOut className="h-4 w-4" />
            Logout
          </button>
        </div>
      )}

      {/* Profile trigger button */}
      <button
        onClick={() => setOpen(!open)}
        className={cn(
          "flex items-center w-full rounded-lg text-left hover:bg-white/5 transition-colors group",
          collapsed ? "justify-center px-2 py-2.5" : "gap-3 px-3 py-2.5"
        )}
      >
        {/* Avatar */}
        {profile?.avatar_url ? (
          <Image
            src={profile.avatar_url}
            alt={profile.full_name ?? ""}
            width={36}
            height={36}
            className={cn(
              "rounded-full object-cover ring-2 ring-white/10",
              collapsed ? "h-8 w-8" : "h-9 w-9"
            )}
          />
        ) : (
          <div
            className={cn(
              "rounded-full bg-gold-500/20 flex items-center justify-center text-gold-400 font-bold ring-2 ring-white/10",
              collapsed ? "h-8 w-8 text-[10px]" : "h-9 w-9 text-xs"
            )}
          >
            {initials}
          </div>
        )}

        {/* Name & role (hidden when collapsed) */}
        {!collapsed && (
          <>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-white truncate">
                {profile?.full_name ?? "Loading..."}
              </p>
              <p className="text-[11px] text-white/40 capitalize">
                {profile?.role ?? ""}
              </p>
            </div>
            <ChevronUp
              className={cn(
                "h-4 w-4 text-white/30 transition-transform duration-200",
                open ? "rotate-0" : "rotate-180"
              )}
            />
          </>
        )}
      </button>
    </div>
  );
}
