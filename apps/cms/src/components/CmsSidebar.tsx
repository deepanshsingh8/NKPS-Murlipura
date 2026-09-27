"use client";

import {
  LayoutDashboard,
  Image as ImageIcon,
  FileText,
  MessageSquare,
  Layers,
  ScrollText,
  Newspaper,
} from "lucide-react";
import {
  SidebarShell,
  type SidebarSection,
} from "@nkps/shared/components/SidebarShell";
import { AppSwitcher } from "@nkps/shared/components/AppSwitcher";
import { useSidebar } from "@nkps/shared/components/providers/SidebarProvider";
import { getErpUrl } from "@nkps/shared/lib/cross-app";

// Sections rather than one "CMS" heading with a "Content" accordion inside it.
// The CMS is small enough that the accordion was pure overhead — it hid four of
// the six destinations behind a tap to save two rows of height.
const cmsSections: SidebarSection[] = [
  {
    label: "Overview",
    items: [{ kind: "link", icon: LayoutDashboard, label: "Dashboard", href: "/" }],
  },
  {
    label: "Content",
    items: [
      { kind: "link", icon: ImageIcon, label: "Gallery", href: "/gallery" },
      { kind: "link", icon: Newspaper, label: "Articles", href: "/articles" },
      { kind: "link", icon: Layers, label: "Site Media", href: "/site-media" },
      { kind: "link", icon: ScrollText, label: "Disclosure", href: "/disclosure" },
    ],
  },
  {
    label: "Records",
    items: [
      {
        kind: "link",
        icon: FileText,
        label: "Transfer Certificates",
        href: "/transfer-certificates",
      },
    ],
  },
  {
    label: "Inbox",
    items: [
      {
        kind: "link",
        icon: MessageSquare,
        label: "Contact Messages",
        href: "/contact",
      },
    ],
  },
];

const EDITOR_ALWAYS_ALLOWED = new Set(["/"]);
const UNREAD_BADGE_HREFS = new Set(["/contact"]);

export function CmsSidebar() {
  const { collapsed } = useSidebar();
  return (
    <SidebarShell
      homeHref="/"
      sections={cmsSections}
      headerTitle="NKPS CMS"
      headerSubtitle="Content"
      editorAlwaysAllowedHrefs={EDITOR_ALWAYS_ALLOWED}
      unreadBadgeHrefs={UNREAD_BADGE_HREFS}
      // Portal routes are served by the ERP app, not this one — a relative
      // /portal/settings here is a 404, which is what it had been.
      settingsHref={getErpUrl("/portal/settings?from=cms")}
      logoutRedirect="/login"
      footerExtra={<AppSwitcher scope="cms" collapsed={collapsed} />}
    />
  );
}
