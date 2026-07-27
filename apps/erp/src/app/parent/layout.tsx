"use client";

import { ParentSidebar } from "@/components/portal/ParentSidebar";
import { SidebarProvider } from "@nkps/shared/components/providers/SidebarProvider";
import { AppShell } from "@nkps/shared/components/AppShell";

export default function ParentLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <SidebarProvider>
      <AppShell sidebar={<ParentSidebar />} title="Parent Portal">
        {children}
      </AppShell>
    </SidebarProvider>
  );
}
