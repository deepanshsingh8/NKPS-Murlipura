"use client";

import { usePathname } from "next/navigation";
import { Navbar } from "@/components/layout/Navbar";
import { Footer } from "@/components/layout/Footer";
import { TopBar } from "@/components/layout/TopBar";
import { ScrollToTop } from "@/components/layout/ScrollToTop";
import { ChalkCursor } from "@/components/layout/ChalkCursor";
import { ChatBot } from "@nkps/shared/components/ChatBot";
import { WhatsAppButton } from "@nkps/shared/components/WhatsAppButton";

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
    <div className="site-chalk flex min-h-screen flex-col">
      <ChalkCursor />
      <TopBar />
      <Navbar />
      {children}
      <Footer />
      <ScrollToTop />
      <WhatsAppButton />
      <ChatBot />
    </div>
  );
}
