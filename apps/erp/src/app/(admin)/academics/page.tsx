"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  GraduationCap,
  BookOpen,
  CalendarDays,
  Sparkles,
  ArrowRight,
  type LucideIcon,
} from "lucide-react";
import { createClient } from "@nkps/shared/lib/supabase/client";
import type { UserRole } from "@nkps/shared/types";
import { type FeatureKey } from "@nkps/shared/lib/permissions";
import { cn } from "@nkps/shared/lib/utils";

type AcademicsTile = {
  label: string;
  description: string;
  href: string;
  icon: LucideIcon;
  accentColor: string;
  featureKey: FeatureKey | null;
};

const tiles: AcademicsTile[] = [
  {
    label: "Classes",
    description:
      "Define classes and sections per academic year, assign class teachers, and configure streams for XI/XII.",
    href: "/academics/classes",
    icon: GraduationCap,
    accentColor: "text-blue-600 bg-blue-100 dark:bg-blue-900/30",
    featureKey: "classes",
  },
  {
    label: "Subjects",
    description:
      "Maintain the subject master list. Mark subjects as active or elective; used across classes and results.",
    href: "/academics/subjects",
    icon: BookOpen,
    accentColor: "text-emerald-600 bg-emerald-100 dark:bg-emerald-900/30",
    featureKey: "subjects",
  },
  {
    label: "Class XI–XII Electives",
    description:
      "Manage Elective 5 / Elective 6 slot options and per-student picks for senior classes.",
    href: "/academics/electives",
    icon: BookOpen,
    accentColor: "text-amber-600 bg-amber-100 dark:bg-amber-900/30",
    featureKey: "students",
  },
  {
    label: "Academic Years",
    description:
      "Set up and switch the active academic year. Everything exam, fee, and enrollment-related scopes to this.",
    href: "/academics/years",
    icon: CalendarDays,
    accentColor: "text-violet-600 bg-violet-100 dark:bg-violet-900/30",
    featureKey: "academic_years",
  },
  {
    label: "Non-Scholastic Classes",
    description:
      "Grade students on co-scholastic sub-skills per class and exam. Overrides teacher-entered grades.",
    href: "/exams/non-scholastic-assessments",
    icon: Sparkles,
    accentColor: "text-rose-600 bg-rose-100 dark:bg-rose-900/30",
    featureKey: "non_scholastic_entry",
  },
];

export default function AdminAcademicsHubPage() {
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
    if (userRole === "admin") return true;
    return t.featureKey ? permissions?.has(t.featureKey) : true;
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-bold text-navy-900 dark:text-white">
          Academics
        </h1>
        <p className="text-gray-500 dark:text-gray-400 mt-1">
          Structural setup for the school year — classes, subjects, and the
          academic calendar that everything else scopes to.
        </p>
      </div>

      {userRole !== "admin" && permissions === null ? (
        <div className="flex items-center justify-center h-40">
          <div className="h-6 w-6 animate-spin rounded-full border-4 border-navy-900 border-t-transparent" />
        </div>
      ) : visibleTiles.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-gray-300 dark:border-gray-700 p-10 text-center">
          <p className="text-gray-500 dark:text-gray-400">
            You don&apos;t have access to any academics features yet. Ask an
            admin to grant permissions.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {visibleTiles.map((tile) => {
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
      )}
    </div>
  );
}
