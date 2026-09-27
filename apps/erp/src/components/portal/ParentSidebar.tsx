"use client";

import {
  LayoutDashboard,
  ClipboardCheck,
  BarChart3,
  CreditCard,
  CalendarDays,
  Clock,
  IdCard,
  MessageSquare,
  Bus,
  NotebookPen,
} from "lucide-react";
import {
  SidebarShell,
  type SidebarSection,
} from "@nkps/shared/components/SidebarShell";
import { AgentMark } from "@nkps/shared/components/icons/AgentMark";

const sections: SidebarSection[] = [
  {
    label: "Overview",
    items: [
      { kind: "link", icon: LayoutDashboard, label: "Dashboard", href: "/parent" },
      { kind: "link", icon: NotebookPen, label: "Class Diary", href: "/parent/diary" },
      { kind: "link", icon: AgentMark, label: "Ask the school", href: "/parent/ask" },
    ],
  },
  {
    label: "Academics",
    items: [
      { kind: "link", icon: ClipboardCheck, label: "Attendance", href: "/parent/attendance" },
      { kind: "link", icon: BarChart3, label: "Results", href: "/parent/results" },
      { kind: "link", icon: IdCard, label: "Admit Cards", href: "/parent/admit-cards" },
      { kind: "link", icon: Clock, label: "Timetable", href: "/parent/timetable" },
      { kind: "link", icon: MessageSquare, label: "PTM Notes", href: "/parent/ptm" },
    ],
  },
  {
    label: "Fees & transport",
    items: [
      { kind: "link", icon: CreditCard, label: "Fees", href: "/parent/fees" },
      { kind: "link", icon: Bus, label: "Transport", href: "/parent/transport" },
    ],
  },
  {
    label: "School",
    items: [
      { kind: "link", icon: CalendarDays, label: "Calendar", href: "/parent/calendar" },
    ],
  },
];

export function ParentSidebar() {
  return (
    <SidebarShell
      homeHref="/parent"
      sections={sections}
      headerTitle="Parent Portal"
      headerSubtitle="Parent"
      gate="none"
    />
  );
}
