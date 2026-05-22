"use client";

import {
  LayoutDashboard,
  Image as ImageIcon,
  FileText,
  MessageSquare,
  Layers,
  ScrollText,
  Newspaper,
  FolderOpen,
} from "lucide-react";
import {
  SidebarShell,
  type SidebarItem,
} from "@nkps/shared/components/SidebarShell";
import { AppSwitcher } from "@nkps/shared/components/AppSwitcher";
import { useSidebar } from "@nkps/shared/components/providers/SidebarProvider";

const cmsItems: SidebarItem[] = [
  { kind: "link", icon: LayoutDashboard, label: "Dashboard", href: "/" },
  {
    kind: "group",
    icon: FolderOpen,
    label: "Content",
    landingHref: "/",
    hideOverview: true,
    children: [
      { kind: "link", icon: ImageIcon, label: "Gallery", href: "/gallery" },
      { kind: "link", icon: Newspaper, label: "Articles", href: "/articles" },
      { kind: "link", icon: Layers, label: "Site Media", href: "/site-media" },
      { kind: "link", icon: ScrollText, label: "Disclosure", href: "/disclosure" },
    ],
  },
  { kind: "link", icon: FileText, label: "Transfer Certificates", href: "/transfer-certificates" },
  { kind: "link", icon: MessageSquare, label: "Contact Messages", href: "/contact" },
];

const EDITOR_ALWAYS_ALLOWED = new Set(["/"]);
const UNREAD_BADGE_HREFS = new Set(["/contact"]);

export function CmsSidebar() {
  const { collapsed } = useSidebar();
  return (
    <SidebarShell
      sections={[{ label: "CMS", items: cmsItems }]}
      headerTitle="NKPS CMS"
      headerSubtitle="Content"
      editorAlwaysAllowedHrefs={EDITOR_ALWAYS_ALLOWED}
      unreadBadgeHrefs={UNREAD_BADGE_HREFS}
      settingsHref="/portal/settings?from=cms"
      logoutRedirect="/login"
      footerExtra={<AppSwitcher scope="cms" collapsed={collapsed} />}
    />
  );
}
