"use client";

import { ErpSidebar } from "@/components/ErpSidebar";
import { SidebarProvider, useSidebar } from "@nkps/shared/components/providers/SidebarProvider";
import { cn } from "@nkps/shared/lib/utils";

function ErpLayoutInner({ children }: { children: React.ReactNode }) {
  const { collapsed } = useSidebar();

  return (
    <div className="flex min-h-screen bg-gray-50">
      <ErpSidebar />
      <main className={cn("flex-1 p-8 transition-all duration-300", collapsed ? "ml-[72px]" : "ml-64")}>
        {children}
      </main>
    </div>
  );
}

export default function ErpLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <SidebarProvider>
      <ErpLayoutInner>{children}</ErpLayoutInner>
    </SidebarProvider>
  );
}
