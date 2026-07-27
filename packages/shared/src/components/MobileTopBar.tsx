"use client";

import { Menu } from "lucide-react";
import { useSidebar } from "@nkps/shared/components/providers/SidebarProvider";

// Slim top bar shown only on mobile (the sidebar is off-canvas there). The
// hamburger opens the drawer; the title tells the user which app they're in.
export function MobileTopBar({ title }: { title: string }) {
  const { openMobile } = useSidebar();

  return (
    <header className="lg:hidden sticky top-0 z-20 flex h-14 items-center gap-3 border-b border-navy-900/10 bg-white/95 px-4 backdrop-blur supports-[backdrop-filter]:bg-white/80">
      <button
        type="button"
        onClick={openMobile}
        aria-label="Open menu"
        className="-ml-1 flex h-9 w-9 items-center justify-center rounded-lg text-navy-900 hover:bg-navy-900/5"
      >
        <Menu className="h-6 w-6" />
      </button>
      <span className="truncate font-heading text-lg font-semibold text-navy-900">
        {title}
      </span>
    </header>
  );
}
