"use client";

import { usePathname } from "next/navigation";
import { CmsSidebar } from "@/components/CmsSidebar";
import { SidebarProvider } from "@nkps/shared/components/providers/SidebarProvider";
import { SessionProvider } from "@nkps/shared/components/providers/SessionProvider";
import { AppLockProvider } from "@nkps/shared/components/security/AppLockProvider";
import { AppShell } from "@nkps/shared/components/AppShell";

const NO_SHELL_PATHS = ["/login", "/offline"];

export function CmsShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const bare = NO_SHELL_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));

  if (bare) {
    return <>{children}</>;
  }

  return (
    <SessionProvider>
      <AppLockProvider logoutRedirect="/login">
        <SidebarProvider>
          <AppShell sidebar={<CmsSidebar />} title="NKPS CMS">
            {children}
          </AppShell>
        </SidebarProvider>
      </AppLockProvider>
    </SessionProvider>
  );
}
