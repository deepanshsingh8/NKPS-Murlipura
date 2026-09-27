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
//
// ── variant ─────────────────────────────────────────────────────────────────
// "padded" (the default, and what all five existing layouts get without
// changing a line) puts the page in a normal scrolling document with its own
// padding.
//
// "full" is for a page that manages its own height and scrolling — a chat with
// a pinned composer, say. It swaps min-h-screen for a definite h-dvh and drops
// main's padding. The distinction matters more than it looks: min-h-screen is a
// MINIMUM, so a child asking for h-full has nothing to resolve against and
// silently grows the document instead of scrolling inside it. h-dvh rather than
// h-screen because mobile browser chrome makes 100dvh taller than the visible
// viewport, which hides the composer behind the address bar.
export function AppShell({
  sidebar,
  title,
  children,
  variant = "padded",
}: {
  sidebar: React.ReactNode;
  title: string;
  children: React.ReactNode;
  variant?: "padded" | "full";
}) {
  const { collapsed } = useSidebar();

  const full = variant === "full";

  return (
    <div
      className={cn(
        "flex bg-gray-50 dark:bg-background",
        full ? "h-dvh overflow-hidden" : "min-h-screen"
      )}
    >
      {sidebar}

      {/* No backdrop here any more: MobileNavDrawer portals its own, so that
          the scrim can fade with the drag gesture rather than sitting at a
          fixed opacity underneath a panel moving independently of it. */}

      <div
        className={cn(
          "flex min-w-0 flex-1 flex-col transition-all duration-300",
          // min-h-0 lets the content column shrink below its content, which is
          // what allows a child to scroll rather than pushing the page taller.
          full && "min-h-0",
          collapsed ? "lg:ml-[72px]" : "lg:ml-64"
        )}
      >
        <MobileTopBar title={title} />
        <main
          className={cn(
            "app-safe-x",
            full
              ? "min-h-0 flex-1 overflow-hidden"
              : // The bottom inset rides on top of the existing padding so the
                // last row of a list clears the home indicator instead of
                // sitting behind it.
                "flex-1 px-4 pt-4 pb-[calc(1rem+env(safe-area-inset-bottom,0px))] sm:px-8 sm:pt-8 sm:pb-[calc(2rem+env(safe-area-inset-bottom,0px))]"
          )}
        >
          {children}
        </main>
      </div>
    </div>
  );
}
