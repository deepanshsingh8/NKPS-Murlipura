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
}

const SidebarContext = createContext<SidebarContextType>({
  collapsed: false,
  toggle: () => {},
  mobileOpen: false,
  openMobile: () => {},
  closeMobile: () => {},
});

export function useSidebar() {
  return useContext(SidebarContext);
}

export function SidebarProvider({ children }: { children: React.ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const toggle = useCallback(() => setCollapsed((c) => !c), []);
  const openMobile = useCallback(() => setMobileOpen(true), []);
  const closeMobile = useCallback(() => setMobileOpen(false), []);

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
      value={{ collapsed, toggle, mobileOpen, openMobile, closeMobile }}
    >
      {children}
    </SidebarContext.Provider>
  );
}
