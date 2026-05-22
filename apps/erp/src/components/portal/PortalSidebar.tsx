"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { cn } from "@nkps/shared/lib/utils";
import { SidebarProfileMenu } from "@nkps/shared/components/SidebarProfileMenu";
import { SidebarTooltip } from "@nkps/shared/components/SidebarTooltip";
import { useSidebar } from "@nkps/shared/components/providers/SidebarProvider";

interface PortalSidebarProps {
  title: string;
  role: string;
  navLinks: { href: string; label: string; icon: React.ReactNode }[];
  // Optional sidebar slot rendered just above the profile menu — used by the
  // teacher sidebar to show the AppSwitcher when the user holds editor
  // capability. Students/parents don't pass this.
  footerExtra?: React.ReactNode;
}

export function PortalSidebar({ title, role, navLinks, footerExtra }: PortalSidebarProps) {
  const pathname = usePathname();
  const { collapsed, toggle } = useSidebar();

  const basePath = navLinks[0]?.href ?? "/";

  return (
    <aside
      className={cn(
        "fixed left-0 top-0 h-screen bg-navy-900 flex flex-col z-40 transition-all duration-300 ease-in-out",
        collapsed ? "w-[72px]" : "w-64"
      )}
    >
      {/* Header */}
      <div className={cn("p-4 flex items-center", collapsed ? "justify-center" : "gap-3 px-6")}>
        {!collapsed && (
          <>
            <Image
              src="/images/logo.png"
              alt="NKPS Logo"
              width={36}
              height={36}
              className="rounded-full shrink-0"
            />
            <div className="min-w-0 flex-1">
              <h1 className="font-heading text-xl font-bold text-white truncate">{title}</h1>
              <p className="text-sm text-gold-500 mt-0.5">{role}</p>
            </div>
            <button
              onClick={toggle}
              className="flex items-center justify-center h-7 w-7 rounded-lg text-white/40 hover:bg-white/5 hover:text-white transition-colors shrink-0"
              title="Collapse sidebar"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
          </>
        )}
        {collapsed && (
          <button
            onClick={toggle}
            className="flex items-center justify-center h-8 w-8 rounded-lg hover:bg-white/5 transition-colors"
            title="Expand sidebar"
          >
            <Image
              src="/images/logo.png"
              alt="NKPS Logo"
              width={32}
              height={32}
              className="rounded-full"
            />
          </button>
        )}
      </div>

      {!collapsed && (
        <div className="px-6 mb-2">
          <div className="h-0.5 w-12 bg-gold-500 rounded-full" />
        </div>
      )}

      {/* Navigation */}
      <nav className="flex-1 min-h-0 px-2 overflow-y-auto">
        <div className="space-y-0.5 pb-2">
          {navLinks.map(({ icon, label, href }) => {
            const isActive =
              href === basePath
                ? pathname === basePath
                : pathname.startsWith(href);

            const linkContent = (
              <Link
                href={href}
                className={cn(
                  "flex items-center gap-3 rounded-lg text-sm transition-all duration-200",
                  collapsed ? "px-2.5 py-2.5 justify-center" : "px-3 py-2.5",
                  isActive
                    ? "bg-white/10 text-white font-semibold border-l-[3px] border-gold-500"
                    : "text-white/60 hover:bg-white/5 hover:text-white hover:translate-x-0.5"
                )}
              >
                {icon}
                {!collapsed && <span className="truncate">{label}</span>}
              </Link>
            );

            if (collapsed) {
              return (
                <SidebarTooltip key={href} label={label}>
                  {linkContent}
                </SidebarTooltip>
              );
            }

            return <div key={href}>{linkContent}</div>;
          })}
        </div>
      </nav>

      {footerExtra}
      <SidebarProfileMenu settingsHref="/portal/settings" collapsed={collapsed} />
    </aside>
  );
}
