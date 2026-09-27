"use client";

import { usePathname } from "next/navigation";
import { ErpSidebar } from "@/components/ErpSidebar";
import { SidebarProvider } from "@nkps/shared/components/providers/SidebarProvider";
import { SessionProvider } from "@nkps/shared/components/providers/SessionProvider";
import { AppLockProvider } from "@nkps/shared/components/security/AppLockProvider";
import { AppShell } from "@nkps/shared/components/AppShell";
import { GuideLauncher } from "@/components/GuideLauncher";

/**
 * Pages that manage their own height and scrolling rather than sitting in a
 * padded document.
 *
 * Read from the pathname because the layout renders above the page and cannot
 * be told by it. A route string in a layout is mildly ugly, but it is greppable
 * and it settles on the first paint — a context set from the page inside an
 * effect would render the padded layout first and visibly reflow.
 */
const FULL_BLEED = ["/reports/ask"];

export default function ErpLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const variant = FULL_BLEED.some((p) => pathname.startsWith(p)) ? "full" : "padded";

  return (
    <SessionProvider>
      <AppLockProvider logoutRedirect="/login">
        <SidebarProvider>
          <AppShell sidebar={<ErpSidebar />} title="NKPS ERP" variant={variant}>
            {children}
            <GuideLauncher />
          </AppShell>
        </SidebarProvider>
      </AppLockProvider>
    </SessionProvider>
  );
}
