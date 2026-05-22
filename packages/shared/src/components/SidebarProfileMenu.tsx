"use client";

import { useEffect, useState, useRef } from "react";
import Image from "next/image";
import Link from "next/link";
import { createClient } from "@nkps/shared/lib/supabase/client";
import { Settings, LogOut, ChevronUp, ExternalLink } from "lucide-react";
import { cn } from "@nkps/shared/lib/utils";
import { getWebsiteUrl } from "@nkps/shared/lib/cross-app";
import { toast } from "sonner";

interface UserProfile {
  full_name: string;
  email: string;
  role: string;
  avatar_url: string | null;
}

export function SidebarProfileMenu({
  settingsHref,
  logoutRedirect = "/portal/login",
  collapsed = false,
}: {
  settingsHref: string;
  logoutRedirect?: string;
  collapsed?: boolean;
}) {
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    async function fetchProfile() {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;

      const { data } = await supabase
        .from("profiles")
        .select("full_name, email, role, avatar_url")
        .eq("id", user.id)
        .single();

      if (data) setProfile(data as UserProfile);
    }
    fetchProfile();
  }, []);

  // Close on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    if (open) document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
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
            collapsed ? "left-1 w-48" : "left-3 right-3"
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
          <Link
            href={settingsHref}
            onClick={() => setOpen(false)}
            className="flex items-center gap-3 px-4 py-3 text-sm text-white/70 hover:bg-white/5 hover:text-white transition-colors"
          >
            <Settings className="h-4 w-4" />
            Settings
          </Link>
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
            alt={profile.full_name}
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
