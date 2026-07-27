"use client";

import { ErpSidebar } from "@/components/ErpSidebar";
import { SidebarProvider } from "@nkps/shared/components/providers/SidebarProvider";
import { AppShell } from "@nkps/shared/components/AppShell";

export default function ErpLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <SidebarProvider>
      <AppShell sidebar={<ErpSidebar />} title="NKPS ERP">
        {children}
      </AppShell>
    </SidebarProvider>
  );
}
