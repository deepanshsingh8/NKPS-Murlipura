"use client";

import { usePathname } from "next/navigation";
import dynamic from "next/dynamic";
import { Navbar } from "@/components/layout/Navbar";
import { Footer } from "@/components/layout/Footer";
import { TopBar } from "@/components/layout/TopBar";
import { ScrollToTop } from "@/components/layout/ScrollToTop";
import { ChalkCursor } from "@/components/layout/ChalkCursor";
import { ChalkObjects } from "@/components/layout/ChalkObjects";
import { ChalkWriting } from "@/components/layout/ChalkWriting";

// Floating, below-the-fold widget. Loaded client-side only so its
// framer-motion bundle doesn't compete for the main thread during the initial
// hydration that gates LCP. The unified NKPS Agent combines the AI assistant,
// WhatsApp, and call-the-school actions under a single entry point.
const NkpsAgent = dynamic(
  () => import("@nkps/shared/components/NkpsAgent").then((m) => m.NkpsAgent),
  { ssr: false }
);

export function LayoutShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isAdmin = pathname.startsWith("/admin");
  const isCms = pathname.startsWith("/cms");
  const isErp = pathname.startsWith("/erp") && !pathname.startsWith("/erp-login");
  const isPortal = pathname.startsWith("/portal");
  const isStudent = pathname.startsWith("/student") && !pathname.startsWith("/student-life");
  const isTeacher = pathname.startsWith("/teacher");
  const isParent = pathname.startsWith("/parent");
  const hideChrome = isAdmin || isCms || isErp || isPortal || isStudent || isTeacher || isParent;

  if (hideChrome) {
    return <>{children}</>;
  }

  return (
    <div className="site-chalk">
      <ChalkObjects />
      <ChalkWriting />
      <ChalkCursor />
      <div className="relative z-10 flex min-h-screen flex-col">
        <TopBar />
        <Navbar />
        {children}
        <Footer />
      </div>
      <ScrollToTop />
      <NkpsAgent />
    </div>
  );
}
