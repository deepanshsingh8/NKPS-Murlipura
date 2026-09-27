"use client";

import { useCallback, useSyncExternalStore } from "react";

// Viewport-aware hooks for the parts of the UI that cannot be expressed as a
// Tailwind breakpoint.
//
// Almost every responsive decision in this codebase is (and should stay) a CSS
// class — CSS switches at the real viewport width with no hydration cost. But a
// few things genuinely need a JS answer: rendering a drawer instead of a fixed
// pane, a bottom sheet instead of a centred dialog, 14 bars instead of 31.
// Those are different component trees, not different styles on one tree.
//
// useSyncExternalStore rather than useState + useEffect: it gives React a
// server snapshot to render against, so the first client render matches the
// server's and there is no hydration mismatch. The desktop branch is the server
// snapshot for the same reason the sidebar renders optimistically — a phone
// corrects itself on the first commit, which is imperceptible, whereas the
// reverse flashes a drawer at desktop users on every page load.

function noopSubscribe(): () => void {
  return () => {};
}

export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const mql = window.matchMedia(query);
      mql.addEventListener("change", onChange);
      return () => mql.removeEventListener("change", onChange);
    },
    [query]
  );

  const getSnapshot = useCallback(
    () => window.matchMedia(query).matches,
    [query]
  );

  return useSyncExternalStore(subscribe, getSnapshot, () => false);
}

/**
 * True below the `lg` breakpoint — the same 1024px line the app shell already
 * pivots on (`lg:ml-64`, `lg:hidden`). Kept in sync with Tailwind by hand:
 * there is no tailwind.config to read it from (v4, CSS-first), and the shell's
 * own classes are the source of truth.
 */
export function useIsMobile(): boolean {
  return useMediaQuery("(max-width: 1023px)");
}

/**
 * True when running as an installed app rather than a browser tab.
 *
 * iOS Safari never matched `display-mode: standalone` until 16.4 and still
 * reports the legacy `navigator.standalone` flag, so both are consulted. The
 * legacy flag cannot change without a fresh launch, hence the no-op subscribe.
 */
export function useIsStandalone(): boolean {
  const displayMode = useMediaQuery("(display-mode: standalone)");
  const iosLegacy = useSyncExternalStore(
    noopSubscribe,
    () =>
      (window.navigator as unknown as { standalone?: boolean }).standalone ===
      true,
    () => false
  );
  return displayMode || iosLegacy;
}

/**
 * Honour the OS "reduce motion" setting. Several components roll their own
 * one-shot `matchMedia` read for this; those answer once and never update when
 * the user changes the setting mid-session. This one does.
 */
export function usePrefersReducedMotion(): boolean {
  return useMediaQuery("(prefers-reduced-motion: reduce)");
}
