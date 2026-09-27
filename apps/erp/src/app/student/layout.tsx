"use client";

import { StudentSidebar } from "@/components/portal/StudentSidebar";
import { SidebarProvider } from "@nkps/shared/components/providers/SidebarProvider";
import { SessionProvider } from "@nkps/shared/components/providers/SessionProvider";
import { AppLockProvider } from "@nkps/shared/components/security/AppLockProvider";
import { AppShell } from "@nkps/shared/components/AppShell";

export default function StudentLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <SessionProvider>
      <AppLockProvider logoutRedirect="/portal/login">
        <SidebarProvider>
          <AppShell sidebar={<StudentSidebar />} title="Student Portal">
            {children}
          </AppShell>
        </SidebarProvider>
      </AppLockProvider>
    </SessionProvider>
  );
}
