"use client";

import {
  LayoutDashboard,
  ClipboardCheck,
  BarChart3,
  CreditCard,
  Clock,
  CalendarDays,
  IdCard,
} from "lucide-react";
import { PortalSidebar } from "./PortalSidebar";

const navLinks = [
  {
    href: "/student",
    label: "Dashboard",
    icon: <LayoutDashboard className="h-5 w-5 shrink-0" />,
  },
  {
    href: "/student/attendance",
    label: "Attendance",
    icon: <ClipboardCheck className="h-5 w-5 shrink-0" />,
  },
  {
    href: "/student/results",
    label: "Results",
    icon: <BarChart3 className="h-5 w-5 shrink-0" />,
  },
  {
    href: "/student/admit-cards",
    label: "Admit Cards",
    icon: <IdCard className="h-5 w-5 shrink-0" />,
  },
  {
    href: "/student/fees",
    label: "Fees",
    icon: <CreditCard className="h-5 w-5 shrink-0" />,
  },
  {
    href: "/student/timetable",
    label: "Timetable",
    icon: <Clock className="h-5 w-5 shrink-0" />,
  },
  {
    href: "/student/calendar",
    label: "Calendar",
    icon: <CalendarDays className="h-5 w-5 shrink-0" />,
  },
];

export function StudentSidebar() {
  return (
    <PortalSidebar title="Student Portal" role="Student" navLinks={navLinks} />
  );
}
