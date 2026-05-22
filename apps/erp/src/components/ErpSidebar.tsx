"use client";

import {
  LayoutDashboard,
  Users,
  UserCheck,
  GraduationCap,
  BookOpen,
  CreditCard,
  Calendar,
  CheckSquare,
  CalendarDays,
  ClipboardList,
  Clock,
  FileText,
  MessageSquare,
  UserCog,
  Sparkles,
  CalendarClock,
  IdCard,
  ClipboardCheck,
  Settings2,
  Lock,
  RefreshCw,
  BarChart3,
  Bus,
  Banknote,
  GitPullRequestArrow,
} from "lucide-react";
import {
  SidebarShell,
  type SidebarItem,
} from "@nkps/shared/components/SidebarShell";
import { AppSwitcher } from "@nkps/shared/components/AppSwitcher";
import { useSidebar } from "@nkps/shared/components/providers/SidebarProvider";

const erpItems: SidebarItem[] = [
  { kind: "link", icon: LayoutDashboard, label: "Dashboard", href: "/" },
  {
    kind: "group",
    icon: Users,
    label: "People",
    landingHref: "/people",
    children: [
      { kind: "link", icon: Users, label: "Users", href: "/people/users" },
      { kind: "link", icon: UserCheck, label: "Students", href: "/people/students" },
      { kind: "link", icon: UserCog, label: "Staff", href: "/people/staff" },
    ],
  },
  {
    kind: "group",
    icon: GraduationCap,
    label: "Academics",
    landingHref: "/academics",
    children: [
      { kind: "link", icon: GraduationCap, label: "Classes", href: "/academics/classes" },
      { kind: "link", icon: BookOpen, label: "Subjects", href: "/academics/subjects" },
      { kind: "link", icon: BookOpen, label: "XI–XII Electives", href: "/academics/electives" },
      { kind: "link", icon: CalendarDays, label: "Academic Years", href: "/academics/years" },
      { kind: "link", icon: Sparkles, label: "Non-Scholastic Classes", href: "/exams/non-scholastic-assessments" },
    ],
  },
  {
    kind: "group",
    icon: ClipboardList,
    label: "Exams",
    landingHref: "/exams",
    children: [
      {
        kind: "group",
        icon: Settings2,
        label: "Master",
        landingHref: "/exams",
        hideOverview: true,
        children: [
          { kind: "link", icon: GraduationCap, label: "Grade Master", href: "/exams/grade-master" },
          { kind: "link", icon: ClipboardCheck, label: "Result Master", href: "/exams/result-master" },
          { kind: "link", icon: Sparkles, label: "Non-Scholastic Masters", href: "/exams/non-scholastic-masters" },
        ],
      },
      { kind: "link", icon: ClipboardList, label: "Exam Types", href: "/exams/types" },
      { kind: "link", icon: CalendarClock, label: "Timetable", href: "/exams/timetable" },
      { kind: "link", icon: IdCard, label: "Admit Cards", href: "/exams/admit-cards" },
      { kind: "link", icon: ClipboardCheck, label: "Class Tests", href: "/exams/class-tests" },
      { kind: "link", icon: FileText, label: "Header / Footer", href: "/exams/header-footer" },
      { kind: "link", icon: BarChart3, label: "Results", href: "/exams/results" },
      { kind: "link", icon: Lock, label: "Publish & Finalize", href: "/exams/publish" },
      { kind: "link", icon: MessageSquare, label: "PTM Notes", href: "/exams/ptm-notes" },
      { kind: "link", icon: FileText, label: "PTM Format", href: "/exams/ptm-format" },
      { kind: "link", icon: RefreshCw, label: "Supplementary Exams", href: "/exams/supplementary" },
      {
        kind: "group",
        icon: FileText,
        label: "Sheets & Prints",
        landingHref: "/exams",
        hideOverview: true,
        children: [
          { kind: "link", icon: FileText, label: "Blank Marks List", href: "/exams/blank-marks-list" },
          { kind: "link", icon: FileText, label: "White Sheet", href: "/exams/white-sheet" },
          { kind: "link", icon: FileText, label: "Green Sheet", href: "/exams/green-sheet" },
        ],
      },
    ],
  },
  {
    kind: "group",
    icon: CreditCard,
    label: "Fees",
    landingHref: "/fees/academic",
    hideOverview: true,
    children: [
      { kind: "link", icon: CreditCard, label: "Academic", href: "/fees/academic" },
      { kind: "link", icon: Bus, label: "Transport", href: "/fees/transport" },
      { kind: "link", icon: Banknote, label: "Payment Management", href: "/fees/payments" },
      { kind: "link", icon: GitPullRequestArrow, label: "Change Requests", href: "/fees/change-requests" },
    ],
  },
  {
    kind: "group",
    icon: Clock,
    label: "Timetable",
    landingHref: "/timetable",
    children: [
      { kind: "link", icon: Clock, label: "Class Timetable", href: "/timetable" },
      { kind: "link", icon: UserCog, label: "Teacher Timetable", href: "/timetable/teachers" },
      { kind: "link", icon: RefreshCw, label: "Substitutions", href: "/timetable/substitutions" },
    ],
  },
  { kind: "link", icon: Calendar, label: "Calendar", href: "/calendar" },
  { kind: "link", icon: CheckSquare, label: "Attendance", href: "/attendance" },
];

const EDITOR_ALWAYS_ALLOWED = new Set(["/"]);
const PENDING_REGISTRATION_BADGE_HREFS = new Set(["/people/users"]);
const PENDING_FEE_CHANGE_REQUEST_BADGE_HREFS = new Set(["/fees/change-requests"]);

export function ErpSidebar() {
  const { collapsed } = useSidebar();
  return (
    <SidebarShell
      sections={[{ label: "ERP", items: erpItems }]}
      headerTitle="NKPS ERP"
      headerSubtitle="Operations"
      editorAlwaysAllowedHrefs={EDITOR_ALWAYS_ALLOWED}
      pendingRegistrationBadgeHrefs={PENDING_REGISTRATION_BADGE_HREFS}
      pendingFeeChangeRequestBadgeHrefs={PENDING_FEE_CHANGE_REQUEST_BADGE_HREFS}
      settingsHref="/portal/settings?from=erp"
      logoutRedirect="/login"
      footerExtra={<AppSwitcher scope="erp-admin" collapsed={collapsed} />}
    />
  );
}
