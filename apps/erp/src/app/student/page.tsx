"use client";

import { useEffect, useState } from "react";
import { createClient } from "@nkps/shared/lib/supabase/client";
import Link from "next/link";
import { Badge } from "@nkps/shared/components/ui/badge";
import {
  ClipboardCheck,
  BarChart3,
  CreditCard,
  CalendarDays,
  ArrowRight,
  Clock,
} from "lucide-react";
import { cn } from "@nkps/shared/lib/utils";
import { UpcomingEvents } from "@nkps/shared/components/UpcomingEvents";
import type { Profile } from "@nkps/shared/types";

interface StudentStats {
  attendancePercent: number | null;
  latestResult: string | null;
  feeStatus: "paid" | "pending" | "unknown";
}

export default function StudentDashboard() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [stats, setStats] = useState<StudentStats>({
    attendancePercent: null,
    latestResult: null,
    feeStatus: "unknown",
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchData() {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) return;

      // Fetch profile (includes student_id linking to students table)
      const { data: profileData } = await supabase
        .from("profiles")
        .select("*")
        .eq("id", user.id)
        .single();

      if (profileData) setProfile(profileData);

      // Resolve the linked student record ID
      const studentId = profileData?.student_id;
      if (!studentId) {
        setLoading(false);
        return;
      }

      // Fetch enrollment using the linked student_id
      const { data: enrollment } = await supabase
        .from("student_enrollments")
        .select("class_id")
        .eq("student_id", studentId)
        .limit(1)
        .single();

      const classId = enrollment?.class_id;

      // Attendance percentage
      let attendancePercent: number | null = null;
      if (classId) {
        const { count: totalDays } = await supabase
          .from("attendance")
          .select("*", { count: "exact", head: true })
          .eq("student_id", studentId)
          .eq("class_id", classId);

        const { count: presentDays } = await supabase
          .from("attendance")
          .select("*", { count: "exact", head: true })
          .eq("student_id", studentId)
          .eq("class_id", classId)
          .in("status", ["present", "late"]);

        if (totalDays && totalDays > 0) {
          attendancePercent = Math.round(
            ((presentDays ?? 0) / totalDays) * 100
          );
        }
      }

      // Latest result
      let latestResult: string | null = null;
      const { data: resultData } = await supabase
        .from("results")
        .select("marks_obtained, max_marks, grade")
        .eq("student_id", studentId)
        .order("created_at", { ascending: false })
        .limit(1)
        .single();

      if (resultData) {
        latestResult = resultData.grade
          ? `Grade ${resultData.grade}`
          : `${resultData.marks_obtained}/${resultData.max_marks}`;
      }

      // Fee status — check most recent payment
      let feeStatus: "paid" | "pending" | "unknown" = "unknown";
      const { data: feeData } = await supabase
        .from("fee_payments")
        .select("status")
        .eq("student_id", studentId)
        .order("created_at", { ascending: false })
        .limit(1)
        .single();

      if (feeData) {
        feeStatus = feeData.status === "paid" ? "paid" : "pending";
      }

      setStats({ attendancePercent, latestResult, feeStatus });
      setLoading(false);
    }

    fetchData();
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-navy-900/20 border-t-navy-900" />
      </div>
    );
  }

  const rawName = profile?.full_name?.trim();
  const firstName =
    rawName && !rawName.includes("@") ? rawName.split(" ")[0] : "Student";
  const greeting = new Date().getHours() < 12 ? "Good morning" : new Date().getHours() < 17 ? "Good afternoon" : "Good evening";

  return (
    <div className="space-y-8">
      {/* Welcome */}
      <div>
        <p className="text-sm text-gray-400 dark:text-gray-500 mb-1">{greeting}</p>
        <h1 className="erp-page-title">
          Welcome back, {firstName}!
        </h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
          Here is a summary of your academic progress.
        </p>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
        {/* Attendance */}
        <div className="erp-stat-card relative overflow-hidden group">
          <div className="absolute top-0 right-0 w-24 h-24 bg-gradient-to-bl from-blue-500/8 to-transparent rounded-bl-full" />
          <div className="relative">
            <div className="flex items-center gap-3 mb-3">
              <div className="h-10 w-10 rounded-xl bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center">
                <ClipboardCheck className="h-5 w-5 text-blue-600" />
              </div>
              <span className="text-sm font-medium text-gray-500 dark:text-gray-400">Attendance</span>
            </div>
            <p className="text-3xl font-bold text-navy-900 dark:text-white tracking-tight">
              {stats.attendancePercent !== null
                ? `${stats.attendancePercent}%`
                : "--"}
            </p>
            <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">Overall attendance</p>
          </div>
        </div>

        {/* Latest Result */}
        <div className="erp-stat-card relative overflow-hidden group">
          <div className="absolute top-0 right-0 w-24 h-24 bg-gradient-to-bl from-violet-500/8 to-transparent rounded-bl-full" />
          <div className="relative">
            <div className="flex items-center gap-3 mb-3">
              <div className="h-10 w-10 rounded-xl bg-violet-100 dark:bg-violet-900/30 flex items-center justify-center">
                <BarChart3 className="h-5 w-5 text-violet-600" />
              </div>
              <span className="text-sm font-medium text-gray-500 dark:text-gray-400">Latest Result</span>
            </div>
            <p className="text-3xl font-bold text-navy-900 dark:text-white tracking-tight">
              {stats.latestResult ?? "--"}
            </p>
            <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">Most recent exam</p>
          </div>
        </div>

        {/* Fee Status */}
        <div className={cn(
          "erp-stat-card relative overflow-hidden group",
          stats.feeStatus === "pending" && "ring-1 ring-amber-200"
        )}>
          <div className={cn(
            "absolute top-0 right-0 w-24 h-24 bg-gradient-to-bl rounded-bl-full",
            stats.feeStatus === "paid" ? "from-green-500/8 to-transparent"
              : stats.feeStatus === "pending" ? "from-amber-500/10 to-transparent"
              : "from-gray-500/5 to-transparent"
          )} />
          <div className="relative">
            <div className="flex items-center gap-3 mb-3">
              <div className={cn(
                "h-10 w-10 rounded-xl flex items-center justify-center",
                stats.feeStatus === "paid" ? "bg-green-100 dark:bg-green-950/30"
                  : stats.feeStatus === "pending" ? "bg-amber-100 dark:bg-amber-900/30"
                  : "bg-gray-100 dark:bg-muted"
              )}>
                <CreditCard className={cn(
                  "h-5 w-5",
                  stats.feeStatus === "paid" ? "text-green-600"
                    : stats.feeStatus === "pending" ? "text-amber-600"
                    : "text-gray-400"
                )} />
              </div>
              <span className="text-sm font-medium text-gray-500 dark:text-gray-400">Fee Status</span>
            </div>
            {stats.feeStatus === "paid" ? (
              <Badge className="bg-green-100 dark:bg-green-950/30 text-green-700 dark:text-green-400 text-xs font-semibold">
                Paid
              </Badge>
            ) : stats.feeStatus === "pending" ? (
              <Badge className="bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 text-xs font-semibold">
                Pending
              </Badge>
            ) : (
              <Badge variant="secondary" className="text-xs font-semibold">
                No Records
              </Badge>
            )}
            <p className="text-xs text-gray-400 dark:text-gray-500 mt-2">
              {stats.feeStatus === "paid"
                ? "All fees up to date"
                : stats.feeStatus === "pending"
                  ? "Payment due"
                  : "No fee records found"}
            </p>
          </div>
        </div>
      </div>

      {/* Quick Links */}
      <div>
        <h2 className="erp-section-title mb-4">Quick Links</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {[
            { href: "/student/attendance", icon: ClipboardCheck, label: "View Attendance", color: "bg-navy-900 text-white hover:bg-navy-800" },
            { href: "/student/results", icon: BarChart3, label: "View Results", color: "bg-gold-500 text-navy-900 hover:bg-gold-400" },
            { href: "/student/fees", icon: CreditCard, label: "Check Fees", color: "bg-white dark:bg-card text-navy-900 dark:text-white border border-gray-200 dark:border-border hover:bg-gray-50 dark:hover:bg-muted" },
            { href: "/student/timetable", icon: Clock, label: "Timetable", color: "bg-white dark:bg-card text-navy-900 dark:text-white border border-gray-200 dark:border-border hover:bg-gray-50 dark:hover:bg-muted" },
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
