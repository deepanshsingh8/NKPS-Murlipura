"use client";

import { cn } from "@nkps/shared/lib/utils";
import { useSidebar } from "@nkps/shared/components/providers/SidebarProvider";
import { MobileTopBar } from "@nkps/shared/components/MobileTopBar";

// Shared responsive shell for every module (ERP admin, CMS, and the parent /
// student / teacher portals). The sidebar is a fixed pane; this lays out the
// content column beside it and adds the mobile drawer chrome:
//   - desktop (lg+): content is offset by the pane width (rail or full).
//   - mobile: no offset (full-screen), a top bar exposes the hamburger, and a
//     tap-to-dismiss backdrop sits under the open drawer.
// Must be rendered inside a <SidebarProvider>.
export function AppShell({
  sidebar,
  title,
  children,
}: {
  sidebar: React.ReactNode;
  title: string;
  children: React.ReactNode;
}) {
  const { collapsed, mobileOpen, closeMobile } = useSidebar();

  return (
    <div className="flex min-h-screen bg-gray-50">
      {sidebar}

      {/* Backdrop behind the open mobile drawer. */}
      {mobileOpen && (
        <div
          onClick={closeMobile}
          aria-hidden
          className="fixed inset-0 z-30 bg-black/50 lg:hidden"
        />
      )}

      <div
        className={cn(
          "flex min-w-0 flex-1 flex-col transition-all duration-300",
          collapsed ? "lg:ml-[72px]" : "lg:ml-64"
        )}
      >
        <MobileTopBar title={title} />
        <main className="flex-1 p-4 sm:p-8">{children}</main>
      </div>
    </div>
  );
}
