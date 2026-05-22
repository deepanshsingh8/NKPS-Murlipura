"use client";

import { ParentSidebar } from "@/components/portal/ParentSidebar";
import { SidebarProvider, useSidebar } from "@nkps/shared/components/providers/SidebarProvider";
import { cn } from "@nkps/shared/lib/utils";

function ParentLayoutInner({ children }: { children: React.ReactNode }) {
  const { collapsed } = useSidebar();

  return (
    <div className="flex min-h-screen bg-gray-50">
      <ParentSidebar />
      <main className={cn("flex-1 p-8 transition-all duration-300", collapsed ? "ml-[72px]" : "ml-64")}>
        {children}
      </main>
    </div>
  );
}

export default function ParentLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <SidebarProvider>
      <ParentLayoutInner>{children}</ParentLayoutInner>
    </SidebarProvider>
  );
}
