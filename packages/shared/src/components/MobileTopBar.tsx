"use client";

import { useEffect, useMemo, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { ArrowLeft, Menu } from "lucide-react";
import Link from "next/link";
import { cn } from "@nkps/shared/lib/utils";
import { useSidebar } from "@nkps/shared/components/providers/SidebarProvider";

// The app bar, shown only on mobile (the sidebar is a pane at lg and up).
//
// Three things make it read as an app rather than a page header:
//   - it clears the status bar via the top safe-area inset;
//   - it gains a hairline and a shadow once the page is scrolled, so it detaches
//     from the content instead of floating in the same plane as it;
//   - a sub-page gets a back arrow in place of the hamburger. Which pages those
//     are is not guessable from the path — /people/students is a destination and
//     /people/students/<id> is not, and both are "deep" — so the sidebar
//     publishes its own href list and this checks membership.
const BUTTON_CLASS =
  "flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-navy-900 active:bg-navy-900/5 dark:text-white dark:active:bg-white/10";

export function MobileTopBar({
  title,
  actions,
}: {
  title: string;
  /** Optional right-hand slot for page-level controls. */
  actions?: React.ReactNode;
}) {
  const { openMobile, navHrefs, homeHref } = useSidebar();
  const pathname = usePathname();
  const router = useRouter();
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 4);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const isSubPage = useMemo(
    () => navHrefs.size > 0 && !navHrefs.has(pathname),
    [navHrefs, pathname]
  );

  const goBack = () => {
    // A PWA opened straight onto a deep link has no history to pop, and a back
    // button that does nothing is worse than one that isn't there.
    if (window.history.length > 1) router.back();
    else router.push("/");
  };

  return (
    <header
      data-app-chrome
      className={cn(
        "lg:hidden sticky top-0 z-20 app-safe-t bg-white/95 backdrop-blur transition-shadow supports-[backdrop-filter]:bg-white/80 dark:bg-card/95 dark:supports-[backdrop-filter]:bg-card/80",
        scrolled
          ? "border-b border-navy-900/10 shadow-sm dark:border-border"
          : "border-b border-transparent"
      )}
    >
      <div className="flex h-14 items-center gap-2 px-2">
        {isSubPage ? (
          <button
            type="button"
            onClick={goBack}
            aria-label="Go back"
            className={BUTTON_CLASS}
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
        ) : (
          <button
            type="button"
            onClick={openMobile}
            aria-label="Open menu"
            className={BUTTON_CLASS}
          >
            <Menu className="h-6 w-6" />
          </button>
        )}
        {/* The wordmark is the way home. Tapping the app name to get back to
            the dashboard is what every other app on the phone does, and this
            one was a plain <span> — the most obvious affordance on the screen,
            and it did nothing. */}
        <Link
          href={homeHref}
          className="min-w-0 flex-1 truncate font-heading text-lg font-semibold text-navy-900 transition-opacity hover:opacity-70 dark:text-white"
        >
          {title}
        </Link>
        {actions && (
          <div className="flex shrink-0 items-center gap-1">{actions}</div>
        )}
        {/* On a sub-page the hamburger moves here rather than disappearing.
            Back alone is the iOS convention, but it assumes you arrived from
            the parent screen — and someone opening a deep link from a message,
            or landing here after a refresh, would have no route to the menu at
            all. */}
        {isSubPage && (
          <button
            type="button"
            onClick={openMobile}
            aria-label="Open menu"
            className={BUTTON_CLASS}
          >
            <Menu className="h-6 w-6" />
          </button>
        )}
      </div>
    </header>
  );
}
