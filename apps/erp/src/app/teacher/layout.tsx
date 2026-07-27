"use client";

import { TeacherSidebar } from "@/components/portal/TeacherSidebar";
import { SidebarProvider } from "@nkps/shared/components/providers/SidebarProvider";
import { AppShell } from "@nkps/shared/components/AppShell";

export default function TeacherLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <SidebarProvider>
      <AppShell sidebar={<TeacherSidebar />} title="Teacher Portal">
        {children}
      </AppShell>
    </SidebarProvider>
  );
}
