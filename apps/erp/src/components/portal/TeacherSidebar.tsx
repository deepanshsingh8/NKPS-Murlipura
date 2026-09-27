"use client";

import {
  LayoutDashboard,
  ClipboardCheck,
  BarChart3,
  Clock,
  Users,
  CalendarDays,
  Sparkles,
  FileText,
  MessageSquare,
  NotebookPen,
} from "lucide-react";
import {
  SidebarShell,
  type SidebarSection,
} from "@nkps/shared/components/SidebarShell";
import { AppSwitcher } from "@nkps/shared/components/AppSwitcher";
import { useSidebar } from "@nkps/shared/components/providers/SidebarProvider";

// Grouped by what a teacher is doing, not by what the ERP calls the table:
// the things you enter, the things you look up, and the people you teach.
const sections: SidebarSection[] = [
  {
    label: "Overview",
    items: [
      { kind: "link", icon: LayoutDashboard, label: "Dashboard", href: "/teacher" },
    ],
  },
  {
    label: "Teaching",
    items: [
      { kind: "link", icon: ClipboardCheck, label: "Attendance", href: "/teacher/attendance" },
      { kind: "link", icon: NotebookPen, label: "Class Diary", href: "/teacher/class-diary" },
      { kind: "link", icon: BarChart3, label: "Results", href: "/teacher/results" },
      { kind: "link", icon: FileText, label: "Class Tests", href: "/teacher/class-tests" },
      { kind: "link", icon: Sparkles, label: "Non-Scholastic", href: "/teacher/non-scholastic" },
      { kind: "link", icon: MessageSquare, label: "PTM Notes", href: "/teacher/ptm-notes" },
    ],
  },
  {
    label: "Schedule",
    items: [
      { kind: "link", icon: Clock, label: "Timetable", href: "/teacher/timetable" },
      { kind: "link", icon: CalendarDays, label: "Calendar", href: "/teacher/calendar" },
    ],
  },
  {
    label: "People",
    items: [
      { kind: "link", icon: Users, label: "Students", href: "/teacher/students" },
    ],
  },
];

export function TeacherSidebar() {
  const { collapsed } = useSidebar();
  return (
    <SidebarShell
      homeHref="/teacher"
      sections={sections}
      headerTitle="Teacher Portal"
      headerSubtitle="Teacher"
      // A portal has no feature keys: everything here belongs to the role that
      // the route gate already checked on the way in.
      gate="none"
      footerExtra={<AppSwitcher scope="erp-portal" collapsed={collapsed} />}
    />
  );
}
