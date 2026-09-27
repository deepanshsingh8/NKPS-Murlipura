"use client";

import { ParentSidebar } from "@/components/portal/ParentSidebar";
import { SidebarProvider } from "@nkps/shared/components/providers/SidebarProvider";
import { SessionProvider } from "@nkps/shared/components/providers/SessionProvider";
import { AppLockProvider } from "@nkps/shared/components/security/AppLockProvider";
import { AppShell } from "@nkps/shared/components/AppShell";

export default function ParentLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <SessionProvider>
      <AppLockProvider logoutRedirect="/portal/login">
        <SidebarProvider>
          <AppShell sidebar={<ParentSidebar />} title="Parent Portal">
            {children}
          </AppShell>
        </SidebarProvider>
      </AppLockProvider>
    </SessionProvider>
  );
}
