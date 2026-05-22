"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@nkps/shared/lib/supabase/client";
import Link from "next/link";
import { Badge } from "@nkps/shared/components/ui/badge";
import {
  Users,
  BookOpen,
  ClipboardCheck,
  BarChart3,
  Clock,
  CalendarDays,
  ArrowRight,
  FileWarning,
  MapPin,
} from "lucide-react";
import { cn, dayOfWeekFromDate, formatTime12, timeStringToMinutes, nowMinutes } from "@nkps/shared/lib/utils";
import { UpcomingEvents } from "@nkps/shared/components/UpcomingEvents";
import type { Profile } from "@nkps/shared/types";

interface TeacherStats {
  classCount: number;
  studentCount: number;
  pendingAttendance: boolean;
}

interface TimetablePeriodRow {
  id: string;
  period_number: number;
  start_time: string;
  end_time: string;
  room: string | null;
  day_of_week: number;
  subject: { name: string } | null;
  class: { name: string; section: string } | null;
}

interface PendingResult {
  class_id: string;
  class_label: string;
  subject_id: string;
  subject_name: string;
  exam_type_id: string;
  exam_name: string;
  pending: number;
}

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export default function TeacherDashboard() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [stats, setStats] = useState<TeacherStats>({
    classCount: 0,
    studentCount: 0,
    pendingAttendance: true,
  });
  const [todayPeriods, setTodayPeriods] = useState<TimetablePeriodRow[]>([]);
  const [nextWeekPeriod, setNextWeekPeriod] = useState<TimetablePeriodRow | null>(
    null
  );
  const [pendingResults, setPendingResults] = useState<PendingResult[]>([]);
  const [loading, setLoading] = useState(true);

  const todayDow = useMemo(() => dayOfWeekFromDate(), []);
  const isWeekendOrEmpty = todayDow === 7 || todayPeriods.length === 0;

  useEffect(() => {
    async function fetchData() {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) return;

      // Fetch profile and resolve teacher_id
      const { data: profileData } = await supabase
        .from("profiles")
        .select("*, teacher_id")
        .eq("id", user.id)
        .single();

      if (profileData) setProfile(profileData);

      const teacherId = profileData?.teacher_id;
      if (!teacherId) {
        setLoading(false);
        return;
      }

      // Fetch assigned classes via class_subjects
      const { data: classSubjects } = await supabase
        .from("class_subjects")
        .select("class_id, subject_id, classes(id, name, section), subjects(id, name)")
        .eq("teacher_id", teacherId);

      const classIds = [
        ...new Set((classSubjects ?? []).map((cs) => cs.class_id)),
      ];

      // Also check if class teacher
      const { data: classTeacherClasses } = await supabase
        .from("classes")
        .select("id")
        .eq("class_teacher_id", teacherId);

      const allClassIds = [
        ...new Set([
          ...classIds,
          ...(classTeacherClasses ?? []).map((c) => c.id),
        ]),
      ];

      // Fetch student count from enrollments
      let studentCount = 0;
      if (allClassIds.length > 0) {
        const { count } = await supabase
          .from("student_enrollments")
          .select("*", { count: "exact", head: true })
          .in("class_id", allClassIds);
        studentCount = count ?? 0;
      }

      // Check if attendance marked today
      const today = new Date().toISOString().split("T")[0];
      let pendingAttendance = true;
      if (allClassIds.length > 0) {
        const { count } = await supabase
          .from("attendance")
          .select("*", { count: "exact", head: true })
          .eq("marked_by", user.id)
          .eq("date", today);
        pendingAttendance = (count ?? 0) === 0;
      }

      setStats({
        classCount: allClassIds.length,
        studentCount,
        pendingAttendance,
      });

      // Today's periods for this teacher
      const { data: ttRows } = await supabase
        .from("timetable_periods")
        .select(
          "id, period_number, start_time, end_time, room, day_of_week, subject:subjects(name), class:classes(name, section)"
        )
        .eq("teacher_id", teacherId)
        .order("day_of_week", { ascending: true })
        .order("period_number", { ascending: true });

      const allRows = (ttRows ?? []) as unknown as TimetablePeriodRow[];
      const todaysRows = allRows.filter((r) => r.day_of_week === todayDow);
      todaysRows.sort((a, b) => a.period_number - b.period_number);
      setTodayPeriods(todaysRows);

      // If nothing today, find the nearest upcoming weekday period.
      if (todaysRows.length === 0 && allRows.length > 0) {
        const startDow = todayDow === 7 ? 1 : todayDow + 1;
        for (let i = 0; i < 7; i++) {
          const dow = ((startDow - 1 + i) % 7) + 1;
          if (dow === 7) continue;
          const pick = allRows
            .filter((r) => r.day_of_week === dow)
            .sort((a, b) => a.period_number - b.period_number)[0];
          if (pick) {
            setNextWeekPeriod(pick);
            break;
          }
        }
      }

      // Pending results: for each (class_subject) x (exam_type) compute shortfall.
      const { data: currentYear } = await supabase
        .from("academic_years")
        .select("id")
        .eq("is_current", true)
        .single();

      if (currentYear && classSubjects && classSubjects.length > 0) {
        const { data: examTypes } = await supabase
          .from("exam_types")
          .select("id, name")
          .eq("academic_year_id", currentYear.id)
          .order("sort_order", { ascending: true });

        if (examTypes && examTypes.length > 0) {
          // Enrollment counts per class
          const enrollmentByClass: Record<string, number> = {};
          await Promise.all(
            classIds.map(async (cid) => {
              const { count } = await supabase
                .from("student_enrollments")
                .select("*", { count: "exact", head: true })
                .eq("class_id", cid)
                .eq("status", "active");
              enrollmentByClass[cid] = count ?? 0;
            })
          );

          // For each (class, subject, exam) compute results count
          const pending: PendingResult[] = [];
          for (const cs of classSubjects) {
            const cls = cs.classes as unknown as { id: string; name: string; section: string } | null;
            const sub = cs.subjects as unknown as { id: string; name: string } | null;
            if (!cls || !sub) continue;
            const enrolled = enrollmentByClass[cls.id] ?? 0;
            if (enrolled === 0) continue;
            for (const et of examTypes) {
              const { count: resCount } = await supabase
                .from("results")
                .select("*", { count: "exact", head: true })
                .eq("class_id", cls.id)
                .eq("subject_id", sub.id)
                .eq("exam_type_id", et.id);
              const shortfall = enrolled - (resCount ?? 0);
              if (shortfall > 0) {
                pending.push({
                  class_id: cls.id,
                  class_label: `${cls.name}-${cls.section}`,
                  subject_id: sub.id,
                  subject_name: sub.name,
                  exam_type_id: et.id,
                  exam_name: et.name,
                  pending: shortfall,
                });
              }
            }
          }
          pending.sort((a, b) => b.pending - a.pending);
          setPendingResults(pending.slice(0, 5));
        }
      }

      setLoading(false);
    }

    fetchData();
  }, [todayDow]);

  const now = nowMinutes();
  const nextTodayPeriod = useMemo(
    () =>
      todayPeriods.find(
        (p) => timeStringToMinutes(p.start_time) > now && !p.room?.includes("BREAK")
      ) ??
      todayPeriods.find(
        (p) =>
          timeStringToMinutes(p.start_time) <= now &&
          timeStringToMinutes(p.end_time) > now
      ) ??
      null,
    [todayPeriods, now]
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-navy-900/20 border-t-navy-900" />
      </div>
    );
  }

  const rawName = profile?.full_name?.trim();
  const firstName =
    rawName && !rawName.includes("@") ? rawName.split(" ")[0] : "Teacher";
  const greeting =
    new Date().getHours() < 12
      ? "Good morning"
      : new Date().getHours() < 17
        ? "Good afternoon"
        : "Good evening";

  return (
    <div className="space-y-8">
      {/* Welcome */}
      <div>
        <p className="text-sm text-gray-400 dark:text-gray-500 mb-1">{greeting}</p>
        <h1 className="erp-page-title">Welcome back, {firstName}!</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
          Here is an overview of your classes and tasks for today.
        </p>
      </div>

      {/* Next Class Spotlight */}
      {(nextTodayPeriod || nextWeekPeriod) && (
        <div className="rounded-2xl bg-gradient-to-br from-navy-900 to-navy-800 text-white p-5 shadow-lg">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div>
              <p className="text-xs uppercase tracking-wide text-gold-300/90 mb-1">
                {nextTodayPeriod ? "Next class" : "Next scheduled class"}
              </p>
              <p className="text-xl font-semibold">
                {nextTodayPeriod
                  ? nextTodayPeriod.subject?.name ?? "—"
                  : nextWeekPeriod?.subject?.name ?? "—"}
              </p>
              <p className="text-sm text-white/80 mt-0.5">
                {(nextTodayPeriod ?? nextWeekPeriod)?.class?.name}-
                {(nextTodayPeriod ?? nextWeekPeriod)?.class?.section}
                {" • "}
                {nextTodayPeriod
                  ? "Today"
                  : `${DAY_LABELS[(nextWeekPeriod?.day_of_week ?? 1) % 7]}`}
                {" • "}
                {formatTime12((nextTodayPeriod ?? nextWeekPeriod)?.start_time)} –
                {" "}
                {formatTime12((nextTodayPeriod ?? nextWeekPeriod)?.end_time)}
              </p>
            </div>
            {((nextTodayPeriod ?? nextWeekPeriod)?.room ?? null) && (
              <div className="flex items-center gap-2 text-sm text-white/70">
                <MapPin className="h-4 w-4" />
                {(nextTodayPeriod ?? nextWeekPeriod)?.room}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
        <div className="erp-stat-card relative overflow-hidden group">
          <div className="absolute top-0 right-0 w-24 h-24 bg-gradient-to-bl from-blue-500/8 to-transparent rounded-bl-full" />
          <div className="relative">
            <div className="flex items-center gap-3 mb-3">
              <div className="h-10 w-10 rounded-xl bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center">
                <BookOpen className="h-5 w-5 text-blue-600" />
              </div>
              <span className="text-sm font-medium text-gray-500 dark:text-gray-400">My Classes</span>
            </div>
            <p className="text-3xl font-bold text-navy-900 dark:text-white tracking-tight">
              {stats.classCount}
            </p>
            <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">Assigned classes</p>
          </div>
        </div>

        <div className="erp-stat-card relative overflow-hidden group">
          <div className="absolute top-0 right-0 w-24 h-24 bg-gradient-to-bl from-emerald-500/8 to-transparent rounded-bl-full" />
          <div className="relative">
            <div className="flex items-center gap-3 mb-3">
              <div className="h-10 w-10 rounded-xl bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center">
                <Users className="h-5 w-5 text-emerald-600" />
              </div>
              <span className="text-sm font-medium text-gray-500 dark:text-gray-400">Students</span>
            </div>
            <p className="text-3xl font-bold text-navy-900 dark:text-white tracking-tight">
              {stats.studentCount}
            </p>
            <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">Total students</p>
          </div>
        </div>

        <div
          className={cn(
            "erp-stat-card relative overflow-hidden group",
            stats.pendingAttendance && "ring-1 ring-amber-200"
          )}
        >
          <div
            className={cn(
              "absolute top-0 right-0 w-24 h-24 bg-gradient-to-bl rounded-bl-full",
              stats.pendingAttendance
                ? "from-amber-500/10 to-transparent"
                : "from-green-500/8 to-transparent"
            )}
          />
          <div className="relative">
            <div className="flex items-center gap-3 mb-3">
              <div
                className={cn(
                  "h-10 w-10 rounded-xl flex items-center justify-center",
                  stats.pendingAttendance
                    ? "bg-amber-100 dark:bg-amber-900/30"
                    : "bg-green-100 dark:bg-green-950/30"
                )}
              >
                <ClipboardCheck
                  className={cn(
                    "h-5 w-5",
                    stats.pendingAttendance ? "text-amber-600" : "text-green-600"
                  )}
                />
              </div>
              <span className="text-sm font-medium text-gray-500 dark:text-gray-400">
                Attendance Today
              </span>
            </div>
            {stats.pendingAttendance ? (
              <Badge className="bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 text-xs font-semibold">
                Pending
              </Badge>
            ) : (
              <Badge className="bg-green-100 dark:bg-green-950/30 text-green-700 dark:text-green-400 text-xs font-semibold">
                Marked
              </Badge>
            )}
            <p className="text-xs text-gray-400 dark:text-gray-500 mt-2">
              {stats.pendingAttendance
                ? "Attendance not marked yet"
                : "All done for today"}
            </p>
          </div>
        </div>
      </div>

      {/* Quick Actions */}
      <div>
        <h2 className="erp-section-title mb-4">Quick Actions</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {[
            {
              href: "/teacher/attendance",
              icon: ClipboardCheck,
              label: "Mark Attendance",
              color: "bg-navy-900 text-white hover:bg-navy-800",
            },
            {
              href: "/teacher/results",
              icon: BarChart3,
              label: "Enter Results",
              color: "bg-gold-500 text-navy-900 hover:bg-gold-400",
            },
            {
              href: "/teacher/students",
              icon: Users,
              label: "View Students",
              color:
                "bg-white dark:bg-card text-navy-900 dark:text-white border border-gray-200 dark:border-border hover:bg-gray-50 dark:hover:bg-muted",
            },
            {
              href: "/teacher/timetable",
              icon: Clock,
              label: "View Timetable",
              color:
                "bg-white dark:bg-card text-navy-900 dark:text-white border border-gray-200 dark:border-border hover:bg-gray-50 dark:hover:bg-muted",
            },
          ].map(({ href, icon: Icon, label, color }) => (
            <Link
              key={href}
              href={href}
              className={cn(
                "flex items-center justify-between px-4 py-3 rounded-xl text-sm font-medium transition-all duration-200 group",
                color
              )}
            >
              <div className="flex items-center gap-2.5">
                <Icon className="h-4 w-4" />
                {label}
              </div>
              <ArrowRight className="h-3.5 w-3.5 opacity-50 group-hover:opacity-100 group-hover:translate-x-0.5 transition-all" />
            </Link>
          ))}
        </div>
      </div>

      {/* Today's Timetable */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h2 className="erp-section-title">
            {isWeekendOrEmpty ? "Your Week" : "Today's Timetable"}
          </h2>
          <Link
            href="/teacher/timetable"
            className="text-xs text-gold-600 hover:text-gold-500 font-medium inline-flex items-center gap-1"
          >
            Full timetable
            <ArrowRight className="h-3 w-3" />
          </Link>
        </div>

        {todayPeriods.length > 0 ? (
          <div className="erp-card p-0 overflow-hidden">
            <ul className="divide-y divide-gray-100 dark:divide-border">
              {todayPeriods.map((p) => {
                const startM = timeStringToMinutes(p.start_time);
                const endM = timeStringToMinutes(p.end_time);
                const isPast = endM <= now;
                const isNow = startM <= now && endM > now;
                return (
                  <li
                    key={p.id}
                    className={cn(
                      "flex items-center gap-4 px-4 py-3 text-sm",
                      isPast && "opacity-60",
                      isNow && "bg-gold-50 dark:bg-gold-500/10"
                    )}
                  >
                    <div className="w-20 shrink-0 text-xs text-gray-500 dark:text-gray-400">
                      {formatTime12(p.start_time)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-navy-900 dark:text-white truncate">
                        {p.subject?.name ?? "—"}
                      </p>
                      <p className="text-xs text-gray-500 dark:text-gray-400 truncate">
                        {p.class?.name}-{p.class?.section}
                        {p.room ? ` • ${p.room}` : ""}
                      </p>
                    </div>
                    {isNow && (
                      <Badge className="bg-gold-500/20 text-gold-700 dark:text-gold-300 text-[10px] font-semibold">
                        Now
                      </Badge>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        ) : (
          <div className="erp-card">
            <div className="flex flex-col items-center justify-center py-10 text-center">
              <div className="h-12 w-12 rounded-xl bg-gray-100 dark:bg-muted flex items-center justify-center mb-3">
                <Clock className="h-6 w-6 text-gray-400 dark:text-gray-500" />
              </div>
              <p className="text-sm font-medium text-gray-600 dark:text-gray-300">
                {todayDow === 7
                  ? "No school on Sunday"
                  : "No classes scheduled for today"}
              </p>
              {nextWeekPeriod && (
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                  Next up: {nextWeekPeriod.subject?.name} ·{" "}
                  {nextWeekPeriod.class?.name}-{nextWeekPeriod.class?.section} ·{" "}
                  {DAY_LABELS[nextWeekPeriod.day_of_week % 7]}{" "}
                  {formatTime12(nextWeekPeriod.start_time)}
                </p>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Pending Results */}
      {pendingResults.length > 0 && (
        <div>
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <FileWarning className="h-5 w-5 text-amber-500" />
              <h2 className="erp-section-title">Results pending your entry</h2>
            </div>
            <Link
              href="/teacher/results"
              className="text-xs text-gold-600 hover:text-gold-500 font-medium inline-flex items-center gap-1"
            >
              Open results
              <ArrowRight className="h-3 w-3" />
            </Link>
          </div>
          <div className="erp-card p-0 overflow-hidden">
            <ul className="divide-y divide-gray-100 dark:divide-border">
              {pendingResults.map((pr) => {
                const href = `/teacher/results?class_id=${pr.class_id}&subject_id=${pr.subject_id}&exam_type_id=${pr.exam_type_id}`;
                return (
                  <li key={`${pr.class_id}-${pr.subject_id}-${pr.exam_type_id}`}>
                    <Link
                      href={href}
                      className="flex items-center justify-between gap-4 px-4 py-3 text-sm hover:bg-gray-50 dark:hover:bg-muted transition-colors"
                    >
                      <div className="min-w-0">
                        <p className="font-medium text-navy-900 dark:text-white truncate">
                          {pr.subject_name} · {pr.class_label}
                        </p>
                        <p className="text-xs text-gray-500 dark:text-gray-400 truncate">
                          {pr.exam_name}
                        </p>
                      </div>
                      <div className="flex items-center gap-3 shrink-0">
                        <Badge className="bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 text-xs">
                          {pr.pending} pending
                        </Badge>
                        <ArrowRight className="h-3.5 w-3.5 text-gray-400" />
                      </div>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        </div>
      )}

      {/* Upcoming Events */}
      <div>
        <div className="flex items-center gap-2 mb-4">
          <CalendarDays className="h-5 w-5 text-gray-400 dark:text-gray-500" />
          <h2 className="erp-section-title">Upcoming Events</h2>
        </div>
        <UpcomingEvents limit={5} />
      </div>
    </div>
  );
}
