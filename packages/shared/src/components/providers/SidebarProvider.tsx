"use client";

import { createContext, useContext, useState, useCallback, useEffect } from "react";
import { usePathname } from "next/navigation";

interface SidebarContextType {
  // Desktop-only: collapses the pane to an icon rail (vs full width).
  collapsed: boolean;
  toggle: () => void;
  // Mobile-only: whether the off-canvas drawer is open.
  mobileOpen: boolean;
  openMobile: () => void;
  closeMobile: () => void;
  /**
   * Every href the sidebar can navigate to, published by SidebarShell.
   *
   * The mobile app bar uses it to answer "is this a destination, or somewhere
   * deeper?" and show a back arrow only for the latter. Deriving that from the
   * path shape does not work here — /people/students is two segments deep and
   * is a destination; /people/students/<id> is three and is not.
   */
  navHrefs: ReadonlySet<string>;
  publishNavHrefs: (hrefs: ReadonlySet<string>) => void;
  /**
   * Where the wordmark goes. Published by SidebarShell because "the
   * dashboard" is a different route in each module — "/" for the ERP and the
   * CMS, "/teacher", "/student", "/parent" for the portals — and the app bar
   * that renders the wordmark has no idea which one it is inside.
   */
  homeHref: string;
  publishHomeHref: (href: string) => void;
}

const NO_HREFS: ReadonlySet<string> = new Set();

const SidebarContext = createContext<SidebarContextType>({
  collapsed: false,
  toggle: () => {},
  mobileOpen: false,
  openMobile: () => {},
  closeMobile: () => {},
  navHrefs: NO_HREFS,
  publishNavHrefs: () => {},
  homeHref: "/",
  publishHomeHref: () => {},
});

export function useSidebar() {
  return useContext(SidebarContext);
}

export function SidebarProvider({ children }: { children: React.ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [navHrefs, setNavHrefs] = useState<ReadonlySet<string>>(NO_HREFS);
  const [homeHref, setHomeHref] = useState("/");
  const toggle = useCallback(() => setCollapsed((c) => !c), []);
  const openMobile = useCallback(() => setMobileOpen(true), []);
  const closeMobile = useCallback(() => setMobileOpen(false), []);
  const publishNavHrefs = useCallback((hrefs: ReadonlySet<string>) => {
    // Same-content guard: the sidebar re-publishes whenever its permission
    // filter re-runs, and swapping in an equal set would re-render every
    // consumer for nothing.
    setNavHrefs((prev) =>
      prev.size === hrefs.size && [...hrefs].every((h) => prev.has(h))
        ? prev
        : hrefs
    );
  }, []);

  const publishHomeHref = useCallback((href: string) => {
    setHomeHref((prev) => (prev === href ? prev : href));
  }, []);

  const pathname = usePathname();
  // Close the mobile drawer whenever the route changes — covers tapping a nav
  // link, so the user lands on the new page with a full-screen view.
  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  // Lock background scroll while the mobile drawer overlays the page.
  useEffect(() => {
    if (typeof document === "undefined") return;
    document.body.style.overflow = mobileOpen ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [mobileOpen]);

  return (
    <SidebarContext.Provider
      value={{
        collapsed,
        toggle,
        mobileOpen,
        openMobile,
        closeMobile,
        navHrefs,
        publishNavHrefs,
        homeHref,
        publishHomeHref,
      }}
    >
      {children}
    </SidebarContext.Provider>
  );
}
