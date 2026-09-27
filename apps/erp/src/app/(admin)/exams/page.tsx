"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  ClipboardList,
  BarChart3,
  GraduationCap,
  FileText,
  Sparkles,
  CalendarClock,
  IdCard,
  ClipboardCheck,
  Lock,
  MessageSquare,
  RefreshCw,
  ArrowRight,
  type LucideIcon,
} from "lucide-react";
import { createClient } from "@nkps/shared/lib/supabase/client";
import type { UserRole } from "@nkps/shared/types";
import { type FeatureKey } from "@nkps/shared/lib/permissions";
import { cn } from "@nkps/shared/lib/utils";

type ExamGroup = "setup" | "conduct" | "marks" | "output" | "ptm";

/**
 * The five stages of an exam cycle, in the order the office works through them.
 * Mirrors the sidebar's Examinations groups exactly — if the two disagree, the
 * hub is telling a different story about the section than the menu beside it.
 */
const GROUPS: { key: ExamGroup; label: string; blurb: string }[] = [
  { key: "setup", label: "Setup", blurb: "Configured once a year, then left alone." },
  { key: "conduct", label: "Conduct", blurb: "Before and during the exam itself." },
  { key: "marks", label: "Marks Entry", blurb: "Where marks go in." },
  { key: "output", label: "Results & Sheets", blurb: "What comes out at the end." },
  { key: "ptm", label: "Parent Meetings", blurb: "Notes and handouts for the meeting." },
];

type ExamTile = {
  label: string;
  group: ExamGroup;
  description: string;
  href: string;
  icon: LucideIcon;
  accentColor: string;
  featureKey: FeatureKey | null;
  adminOnly?: boolean;
};

const tiles: ExamTile[] = [
  {
    // Moved here from the Academics hub, which listed it despite it being an
    // /exams screen. "Grades" rather than "Classes": it grades against the
    // areas Non-Scholastic Masters defines, and the old name read like class
    // management.
    label: "Non-Scholastic Grades",
    group: "marks",
    description:
      "Grade students on co-scholastic sub-skills per class and exam. Overrides teacher-entered grades.",
    href: "/exams/non-scholastic-assessments",
    icon: Sparkles,
    accentColor: "text-rose-600 bg-rose-100 dark:bg-rose-900/30",
    featureKey: "non_scholastic_entry",
  },
  {
    label: "Exam Types",
    description:
      "Define exam instances (Half-Yearly, Annual, Class Tests) with max marks and ordering.",
    href: "/exams/types",
    group: "setup",
    icon: ClipboardList,
    accentColor: "text-orange-600 bg-orange-100 dark:bg-orange-900/30",
    featureKey: "exam_types",
  },
  {
    label: "Grade Master",
    description:
      "Define grade cutoffs globally or per class. Applied automatically by report cards and teacher grading.",
    href: "/exams/grade-master",
    group: "setup",
    icon: GraduationCap,
    accentColor: "text-amber-600 bg-amber-100 dark:bg-amber-900/30",
    featureKey: null,
    adminOnly: true,
  },
  {
    label: "Result Master",
    description:
      "Configure pass criteria, weightage, grace marks, rounding, and report card rules per class.",
    href: "/exams/result-master",
    group: "setup",
    icon: ClipboardCheck,
    accentColor: "text-emerald-600 bg-emerald-100 dark:bg-emerald-900/30",
    featureKey: null,
    adminOnly: true,
  },
  {
    label: "Header / Footer",
    description:
      "School branding and signature blocks for report cards, admit cards, and other generated PDFs.",
    href: "/exams/header-footer",
    group: "setup",
    icon: FileText,
    accentColor: "text-teal-600 bg-teal-100 dark:bg-teal-900/30",
    featureKey: null,
    adminOnly: true,
  },
  {
    label: "Non-Scholastic Masters",
    description:
      "Co-scholastic subjects and sub-skills (Discipline, Arts, Sports) that teachers grade alongside academics.",
    href: "/exams/non-scholastic-masters",
    group: "setup",
    icon: Sparkles,
    accentColor: "text-pink-600 bg-pink-100 dark:bg-pink-900/30",
    featureKey: null,
    adminOnly: true,
  },
  {
    label: "Exam Timetable",
    description:
      "Schedule the date, time, and room for each subject's paper per class and exam.",
    href: "/exams/timetable",
    group: "conduct",
    icon: CalendarClock,
    accentColor: "text-cyan-600 bg-cyan-100 dark:bg-cyan-900/30",
    featureKey: "exam_timetable",
  },
  {
    label: "Admit Cards",
    description:
      "Design reusable admit card templates and generate student-specific PDFs before each exam.",
    href: "/exams/admit-cards",
    group: "conduct",
    icon: IdCard,
    accentColor: "text-fuchsia-600 bg-fuchsia-100 dark:bg-fuchsia-900/30",
    featureKey: "admit_cards",
  },
  {
    label: "Results",
    description:
      "Class and subject-wise performance overview, top performers, and pass rates.",
    href: "/exams/results",
    group: "marks",
    icon: BarChart3,
    accentColor: "text-indigo-600 bg-indigo-100 dark:bg-indigo-900/30",
    featureKey: "results",
  },
  {
    label: "Class Tests",
    description:
      "Unit tests and formative assessments — teachers create and grade, admin oversees across classes.",
    href: "/exams/class-tests",
    group: "marks",
    icon: ClipboardCheck,
    accentColor: "text-lime-600 bg-lime-100 dark:bg-lime-900/30",
    featureKey: "class_tests",
  },
  {
    label: "Publish & Finalize",
    description:
      "Flip online visibility for students/parents, then snapshot official marksheet PDFs that survive later edits.",
    href: "/exams/publish",
    group: "output",
    icon: Lock,
    accentColor: "text-slate-600 bg-slate-100 dark:bg-slate-900/30",
    featureKey: "publish_results",
  },
  {
    label: "Blank Marks List",
    description:
      "Print-ready roster (roll, name, empty marks column) for invigilators to record marks during grading.",
    href: "/exams/blank-marks-list",
    group: "conduct",
    icon: FileText,
    accentColor: "text-sky-600 bg-sky-100 dark:bg-sky-900/30",
    featureKey: "blank_marks_list",
  },
  {
    label: "White Sheet",
    description:
      "Class-wide marks grid for a single exam — subjects across, students down — with totals and grade.",
    href: "/exams/white-sheet",
    group: "output",
    icon: FileText,
    accentColor: "text-zinc-600 bg-zinc-100 dark:bg-zinc-900/30",
    featureKey: "white_sheet",
  },
  {
    label: "Green Sheet",
    description:
      "Year-end consolidated view — per-exam totals plus weighted final result across all applicable exams.",
    href: "/exams/green-sheet",
    group: "output",
    icon: FileText,
    accentColor: "text-green-700 bg-green-100 dark:bg-green-900/30",
    featureKey: "green_sheet",
  },
  {
    label: "PTM Notes",
    description:
      "Record attendance, teacher and parent remarks, and action points from each parent-teacher meeting.",
    href: "/exams/ptm-notes",
    group: "ptm",
    icon: MessageSquare,
    accentColor: "text-rose-600 bg-rose-100 dark:bg-rose-900/30",
    featureKey: "ptm_notes",
  },
  {
    label: "PTM Format",
    description:
      "Design and print the pre-meeting handout: student details, performance snapshot, and remarks space.",
    href: "/exams/ptm-format",
    group: "ptm",
    icon: FileText,
    accentColor: "text-rose-700 bg-rose-50 dark:bg-rose-950/30",
    featureKey: "ptm_format",
  },
  {
    label: "Supplementary Exams",
    description:
      "Identify students close to passing, record retest marks, and let final results recompute automatically.",
    href: "/exams/supplementary",
    group: "marks",
    icon: RefreshCw,
    accentColor: "text-amber-700 bg-amber-100 dark:bg-amber-900/30",
    featureKey: "supplementary_exams",
  },
];

export default function AdminExamsHubPage() {
  const [userRole, setUserRole] = useState<UserRole | null>(null);
  const [permissions, setPermissions] = useState<Set<FeatureKey> | null>(null);

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) return;
      supabase
        .from("profiles")
        .select("role")
        .eq("id", user.id)
        .single()
        .then(({ data }) => {
          const role = (data?.role as UserRole) ?? null;
          setUserRole(role);
          if (role === "admin") {
            setPermissions(new Set());
            return;
          }
          supabase
            .from("editor_permissions")
            .select("feature_key")
            .eq("editor_id", user.id)
            .then(({ data: rows }) => {
              setPermissions(
                new Set<FeatureKey>(
                  (rows ?? []).map((r) => r.feature_key as FeatureKey)
                )
              );
            });
        });
    });
  }, []);

  const visibleTiles = tiles.filter((t) => {
    if (t.adminOnly && userRole !== "admin") return false;
    if (userRole === "admin") return true;
    return t.featureKey ? permissions?.has(t.featureKey) : true;
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-bold text-navy-900 dark:text-white">
          Exams
        </h1>
        <p className="text-gray-500 dark:text-gray-400 mt-1">
          Everything related to examinations — types, schedules, marks, results,
          and report cards.
        </p>
      </div>

      {userRole !== "admin" && permissions === null ? (
        <div className="flex items-center justify-center h-40">
          <div className="h-6 w-6 animate-spin rounded-full border-4 border-navy-900 border-t-transparent" />
        </div>
      ) : visibleTiles.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-gray-300 dark:border-gray-700 p-10 text-center">
          <p className="text-gray-500 dark:text-gray-400">
            You don&apos;t have access to any exam features yet. Ask an admin to
            grant permissions.
          </p>
        </div>
      ) : (
        <div className="space-y-8">
          {GROUPS.map((group) => {
            const inGroup = visibleTiles.filter((t) => t.group === group.key);
            // An editor granted only some exam features sees only the stages
            // they can act on, not five headings with gaps under them. Matches
            // how the sidebar drops a group whose children all filter out.
            if (inGroup.length === 0) return null;
            return (
              <section key={group.key}>
                <h2 className="font-heading text-sm font-semibold uppercase tracking-wide text-navy-900 dark:text-white">
                  {group.label}
                </h2>
                <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
                  {group.blurb}
                </p>
                <div className="mt-3 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                  {inGroup.map((tile) => {
                    const Icon = tile.icon;
                    return (
                    <Link
                      key={tile.href}
                      href={tile.href}
                      className={cn(
                        "group rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-card p-5",
                        "transition-all hover:border-gold-500/60 hover:shadow-md hover:-translate-y-0.5"
                      )}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div
                          className={cn(
                            "h-10 w-10 rounded-xl flex items-center justify-center",
                            tile.accentColor
                          )}
                        >
                          <Icon className="h-5 w-5" />
                        </div>
                        <ArrowRight className="h-4 w-4 text-gray-300 dark:text-gray-600 group-hover:text-navy-900 dark:group-hover:text-white transition-colors" />
                      </div>
                      <h3 className="mt-4 font-heading text-base font-semibold text-navy-900 dark:text-white">
                        {tile.label}
                      </h3>
                      <p className="mt-1 text-sm text-gray-500 dark:text-gray-400 line-clamp-2">
                        {tile.description}
                      </p>
                      </Link>
                    );
                  })}
                </div>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
