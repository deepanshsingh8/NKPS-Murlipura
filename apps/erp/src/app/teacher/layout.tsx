"use client";

import { TeacherSidebar } from "@/components/portal/TeacherSidebar";
import { SidebarProvider, useSidebar } from "@nkps/shared/components/providers/SidebarProvider";
import { cn } from "@nkps/shared/lib/utils";

function TeacherLayoutInner({ children }: { children: React.ReactNode }) {
  const { collapsed } = useSidebar();

  return (
    <div className="flex min-h-screen bg-gray-50">
      <TeacherSidebar />
      <main className={cn("flex-1 p-8 transition-all duration-300", collapsed ? "ml-[72px]" : "ml-64")}>
        {children}
      </main>
    </div>
  );
}

export default function TeacherLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <SidebarProvider>
      <TeacherLayoutInner>{children}</TeacherLayoutInner>
    </SidebarProvider>
  );
}
