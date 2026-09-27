"use client";

import {
  LayoutDashboard,
  ClipboardCheck,
  BarChart3,
  CreditCard,
  Clock,
  CalendarDays,
  IdCard,
  NotebookPen,
} from "lucide-react";
import {
  SidebarShell,
  type SidebarSection,
} from "@nkps/shared/components/SidebarShell";

const sections: SidebarSection[] = [
  {
    label: "Overview",
    items: [
      { kind: "link", icon: LayoutDashboard, label: "Dashboard", href: "/student" },
      { kind: "link", icon: NotebookPen, label: "Class Diary", href: "/student/diary" },
    ],
  },
  {
    label: "My studies",
    items: [
      { kind: "link", icon: ClipboardCheck, label: "Attendance", href: "/student/attendance" },
      { kind: "link", icon: BarChart3, label: "Results", href: "/student/results" },
      { kind: "link", icon: IdCard, label: "Admit Cards", href: "/student/admit-cards" },
      { kind: "link", icon: Clock, label: "Timetable", href: "/student/timetable" },
    ],
  },
  {
    label: "School",
    items: [
      { kind: "link", icon: CalendarDays, label: "Calendar", href: "/student/calendar" },
      { kind: "link", icon: CreditCard, label: "Fees", href: "/student/fees" },
    ],
  },
];

export function StudentSidebar() {
  return (
    <SidebarShell
      homeHref="/student"
      sections={sections}
      headerTitle="Student Portal"
      headerSubtitle="Student"
      gate="none"
    />
  );
}
