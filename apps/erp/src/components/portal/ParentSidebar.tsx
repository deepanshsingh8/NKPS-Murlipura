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
} from "lucide-react";
import { PortalSidebar } from "./PortalSidebar";

const navLinks = [
  {
    href: "/parent",
    label: "Dashboard",
    icon: <LayoutDashboard className="h-5 w-5 shrink-0" />,
  },
  {
    href: "/parent/attendance",
    label: "Attendance",
    icon: <ClipboardCheck className="h-5 w-5 shrink-0" />,
  },
  {
    href: "/parent/results",
    label: "Results",
    icon: <BarChart3 className="h-5 w-5 shrink-0" />,
  },
  {
    href: "/parent/admit-cards",
    label: "Admit Cards",
    icon: <IdCard className="h-5 w-5 shrink-0" />,
  },
  {
    href: "/parent/timetable",
    label: "Timetable",
    icon: <Clock className="h-5 w-5 shrink-0" />,
  },
  {
    href: "/parent/fees",
    label: "Fees",
    icon: <CreditCard className="h-5 w-5 shrink-0" />,
  },
  {
    href: "/parent/calendar",
    label: "Calendar",
    icon: <CalendarDays className="h-5 w-5 shrink-0" />,
  },
  {
    href: "/parent/ptm",
    label: "PTM Notes",
    icon: <MessageSquare className="h-5 w-5 shrink-0" />,
  },
];

export function ParentSidebar() {
  return (
    <PortalSidebar title="Parent Portal" role="Parent" navLinks={navLinks} />
  );
}
