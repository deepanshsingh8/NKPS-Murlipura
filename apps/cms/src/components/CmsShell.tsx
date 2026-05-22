"use client";

import { usePathname } from "next/navigation";
import { CmsSidebar } from "@/components/CmsSidebar";
import { SidebarProvider, useSidebar } from "@nkps/shared/components/providers/SidebarProvider";
import { cn } from "@nkps/shared/lib/utils";

const NO_SHELL_PATHS = ["/login"];

function CmsShellInner({ children }: { children: React.ReactNode }) {
  const { collapsed } = useSidebar();

  return (
    <div className="flex min-h-screen bg-gray-50">
      <CmsSidebar />
      <main
        className={cn(
          "flex-1 p-8 transition-all duration-300",
          collapsed ? "ml-[72px]" : "ml-64"
        )}
      >
        {children}
      </main>
    </div>
  );
}

export function CmsShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const bare = NO_SHELL_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));

  if (bare) {
    return <>{children}</>;
  }

  return (
    <SidebarProvider>
      <CmsShellInner>{children}</CmsShellInner>
    </SidebarProvider>
  );
}
