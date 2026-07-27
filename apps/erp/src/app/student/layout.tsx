"use client";

import { StudentSidebar } from "@/components/portal/StudentSidebar";
import { SidebarProvider } from "@nkps/shared/components/providers/SidebarProvider";
import { AppShell } from "@nkps/shared/components/AppShell";

export default function StudentLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <SidebarProvider>
      <AppShell sidebar={<StudentSidebar />} title="Student Portal">
        {children}
      </AppShell>
    </SidebarProvider>
  );
}
