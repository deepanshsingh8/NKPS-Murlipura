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
  MapPin,
  ReceiptText,
  Home,
  FileSpreadsheet,
  UserPlus,
  LayoutGrid,
  TriangleAlert,
  NotebookPen,
} from "lucide-react";
import {
  SidebarShell,
  type SidebarSection,
} from "@nkps/shared/components/SidebarShell";
import { AppSwitcher } from "@nkps/shared/components/AppSwitcher";
import { useSidebar } from "@nkps/shared/components/providers/SidebarProvider";
import { AgentMark } from "@nkps/shared/components/icons/AgentMark";

// The ERP has around sixty destinations. It used to declare all of them under a
// single section whose label was, literally, "ERP" — which is not a category,
// it is the name of the thing you are already inside. On a phone that produced
// one undifferentiated scroll.
//
// These six headings are the actual shape of the work: who is enrolled, what is
// taught, what is examined, what is run day to day, and what it all adds up to.
// Every href is unchanged — this is a reorganisation of the menu, not of the
// app — which also keeps scripts/check-guide-coverage.mjs passing.
const erpSections: SidebarSection[] = [
  {
    // Attendance sits up here rather than under Operations on purpose: it is
    // the one screen that gets opened every single morning.
    label: "Overview",
    items: [
      { kind: "link", icon: LayoutDashboard, label: "Dashboard", href: "/" },
      { kind: "link", icon: CheckSquare, label: "Attendance", href: "/attendance" },
      // Murlipura: the class WhatsApp groups' replacement — opened daily too.
      { kind: "link", icon: NotebookPen, label: "Class Diary", href: "/class-diary" },
      { kind: "link", icon: Calendar, label: "Calendar", href: "/calendar" },
    ],
  },
  {
    label: "People",
    // Two entries, not six. There used to be an Overview hub that duplicated
    // this list (and listed only three of the five), a Registrations link that
    // was a redirect into a tab of Users, and a Teachers page separate from the
    // Teachers TAB inside Staff — two different things wearing one name. Each
    // of those was a menu entry for a piece of plumbing rather than for
    // something the school thinks of as a thing.
    //
    // Users left too, to Administration. What is under People is the school's
    // record of a person: who is enrolled, who is employed, their guardians,
    // their qualifications. Who holds a login and what it may touch is a
    // different question with a different audience — it is admin-only forever,
    // because it is the screen you would use to give yourself more access.
    items: [
      { kind: "link", icon: UserCheck, label: "Students", href: "/people/students" },
      { kind: "link", icon: UserCog, label: "Staff", href: "/people/staff" },
    ],
  },
  {
    label: "Academics",
    items: [
      { kind: "link", icon: LayoutGrid, label: "Overview", href: "/academics" },
      { kind: "link", icon: GraduationCap, label: "Classes", href: "/academics/classes" },
      { kind: "link", icon: BookOpen, label: "Subjects & Assignments", href: "/academics/subjects" },
      { kind: "link", icon: BookOpen, label: "XI–XII Electives", href: "/academics/electives" },
      { kind: "link", icon: CalendarDays, label: "Academic Years", href: "/academics/years" },
      { kind: "link", icon: Home, label: "Houses", href: "/academics/houses" },
      // Non-Scholastic Classes used to sit here despite living at
      // /exams/non-scholastic-assessments. It is mark entry, so it moved to
      // Examinations → Marks Entry.
    ],
  },
  {
    label: "Examinations",
    // Sixteen destinations under one heading was the hardest section in the ERP
    // to find anything in. Grouped by the order the office actually works
    // through a year — set the rules up, run the exam, enter marks, publish and
    // print, meet parents — rather than alphabetically or by screen type.
    //
    // Every group sets hideOverview, so the section keeps exactly ONE route to
    // /exams: the Overview link below. Without it SidebarShell renders an
    // Overview child per group and five links point at one page.
    items: [
      { kind: "link", icon: LayoutGrid, label: "Overview", href: "/exams" },
      {
        // Configured once a year and then left alone.
        kind: "group",
        icon: Settings2,
        label: "Setup",
        landingHref: "/exams",
        hideOverview: true,
        children: [
          { kind: "link", icon: ClipboardList, label: "Exam Types", href: "/exams/types" },
          { kind: "link", icon: GraduationCap, label: "Grade Master", href: "/exams/grade-master" },
          { kind: "link", icon: ClipboardCheck, label: "Result Master", href: "/exams/result-master" },
          { kind: "link", icon: Sparkles, label: "Non-Scholastic Masters", href: "/exams/non-scholastic-masters" },
          { kind: "link", icon: FileText, label: "Header / Footer", href: "/exams/header-footer" },
        ],
      },
      {
        // Before and during the exam itself. Blank Marks List belongs here
        // rather than with the sheets: it is the roster an invigilator carries
        // in, printed before any marks exist.
        kind: "group",
        icon: CalendarClock,
        label: "Conduct",
        landingHref: "/exams",
        hideOverview: true,
        children: [
          { kind: "link", icon: CalendarClock, label: "Exam Timetable", href: "/exams/timetable" },
          { kind: "link", icon: IdCard, label: "Admit Cards", href: "/exams/admit-cards" },
          { kind: "link", icon: FileText, label: "Blank Marks List", href: "/exams/blank-marks-list" },
        ],
      },
      {
        // Where marks actually go in.
        kind: "group",
        icon: ClipboardCheck,
        label: "Marks Entry",
        landingHref: "/exams",
        hideOverview: true,
        children: [
          { kind: "link", icon: BarChart3, label: "Results", href: "/exams/results" },
          { kind: "link", icon: ClipboardCheck, label: "Class Tests", href: "/exams/class-tests" },
          // "Grades", not "Classes" as it read under Academics: it grades
          // against the areas Non-Scholastic Masters defines in Setup, and the
          // old name sounded like a class-management screen.
          { kind: "link", icon: Sparkles, label: "Non-Scholastic Grades", href: "/exams/non-scholastic-assessments" },
          { kind: "link", icon: RefreshCw, label: "Supplementary Exams", href: "/exams/supplementary" },
        ],
      },
      {
        // What comes out at the end.
        kind: "group",
        icon: FileText,
        label: "Results & Sheets",
        landingHref: "/exams",
        hideOverview: true,
        children: [
          { kind: "link", icon: Lock, label: "Publish & Finalize", href: "/exams/publish" },
          { kind: "link", icon: FileText, label: "White Sheet", href: "/exams/white-sheet" },
          { kind: "link", icon: FileText, label: "Green Sheet", href: "/exams/green-sheet" },
        ],
      },
      {
        kind: "group",
        icon: MessageSquare,
        label: "Parent Meetings",
        landingHref: "/exams",
        hideOverview: true,
        children: [
          { kind: "link", icon: MessageSquare, label: "PTM Notes", href: "/exams/ptm-notes" },
          { kind: "link", icon: FileText, label: "PTM Format", href: "/exams/ptm-format" },
        ],
      },
    ],
  },
  {
    label: "Operations",
    items: [
      {
        kind: "group",
        icon: CreditCard,
        label: "Fees",
        landingHref: "/fees/academic",
        hideOverview: true,
        children: [
          { kind: "link", icon: CreditCard, label: "Academic", href: "/fees/academic" },
          { kind: "link", icon: Banknote, label: "Payment Management", href: "/fees/payments" },
          { kind: "link", icon: ReceiptText, label: "Dues & No-Dues", href: "/fees/dues" },
          { kind: "link", icon: GitPullRequestArrow, label: "Change Requests", href: "/fees/change-requests" },
        ],
      },
      {
        kind: "group",
        icon: Bus,
        label: "Transport",
        landingHref: "/transport",
        children: [
          { kind: "link", icon: MapPin, label: "Stops & Fees", href: "/transport/stops" },
          { kind: "link", icon: Bus, label: "Buses & Routes", href: "/transport/buses" },
          { kind: "link", icon: UserCog, label: "Drivers", href: "/transport/drivers" },
          { kind: "link", icon: UserCheck, label: "Student Assignments", href: "/transport/assignments" },
          { kind: "link", icon: GitPullRequestArrow, label: "Change Requests", href: "/transport/changes" },
        ],
      },
      {
        kind: "group",
        icon: Clock,
        label: "Timetable",
        landingHref: "/timetable",
        // Without this the shell adds its own "Overview" to /timetable, which
        // is the same page as the "Class Timetable" child right below it — two
        // links, one destination. Masters, Sheets & Prints and Fees were each
        // patched for this individually; Timetable was missed.
        hideOverview: true,
        children: [
          { kind: "link", icon: Clock, label: "Class Timetable", href: "/timetable" },
          { kind: "link", icon: UserCog, label: "Teacher Timetable", href: "/timetable/teachers" },
          { kind: "link", icon: RefreshCw, label: "Substitutions", href: "/timetable/substitutions" },
      { kind: "link", icon: TriangleAlert, label: "Clash Check", href: "/timetable/clashes" },
          { kind: "link", icon: Sparkles, label: "Auto Generate", href: "/timetable/generate" },
          { kind: "link", icon: FileSpreadsheet, label: "Import from Excel", href: "/timetable/import" },
          { kind: "link", icon: FileText, label: "Period Templates", href: "/timetable/templates" },
        ],
      },
    ],
  },
  {
    label: "Insights",
    items: [
      { kind: "link", icon: LayoutGrid, label: "Overview", href: "/reports" },
      // First in the list on purpose: it is the fastest route to an answer, and
      // for a long time the page had no sidebar entry at all — the only way in
      // was a card on /reports, so anyone who did not scroll never found it.
      { kind: "link", icon: AgentMark, label: "Ask your school", href: "/reports/ask" },
      { kind: "link", icon: UserCheck, label: "Student Report", href: "/reports/students" },
      { kind: "link", icon: ReceiptText, label: "Fee Report", href: "/reports/students?focus=fees" },
      { kind: "link", icon: CheckSquare, label: "Attendance Report", href: "/reports/students?focus=attendance" },
      { kind: "link", icon: BarChart3, label: "Result Report", href: "/reports/students?focus=results" },
    ],
  },
  {
    // The app's own administration rather than the school's data: portal
    // accounts, what each of them may touch, and the sign-up requests waiting
    // to be approved. Admin-only, so most people never see this heading.
    label: "Administration",
    items: [
      { kind: "link", icon: Users, label: "Users & Access", href: "/administration/users" },
    ],
  },
];

const EDITOR_ALWAYS_ALLOWED = new Set(["/"]);
const PENDING_REGISTRATION_BADGE_HREFS = new Set(["/administration/users"]);
const PENDING_FEE_CHANGE_REQUEST_BADGE_HREFS = new Set(["/fees/change-requests"]);
const PENDING_TRANSPORT_CHANGE_BADGE_HREFS = new Set(["/transport/changes"]);

export function ErpSidebar() {
  const { collapsed } = useSidebar();
  return (
    <SidebarShell
      homeHref="/"
      sections={erpSections}
      headerTitle="NKPS ERP"
      headerSubtitle="Operations"
      editorAlwaysAllowedHrefs={EDITOR_ALWAYS_ALLOWED}
      pendingRegistrationBadgeHrefs={PENDING_REGISTRATION_BADGE_HREFS}
      pendingFeeChangeRequestBadgeHrefs={PENDING_FEE_CHANGE_REQUEST_BADGE_HREFS}
      pendingTransportChangeBadgeHrefs={PENDING_TRANSPORT_CHANGE_BADGE_HREFS}
      settingsHref="/portal/settings?from=erp"
      logoutRedirect="/login"
      footerExtra={<AppSwitcher scope="erp-admin" collapsed={collapsed} />}
    />
  );
}
