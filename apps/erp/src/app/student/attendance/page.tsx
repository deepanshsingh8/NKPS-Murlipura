"use client";

import { useEffect, useState } from "react";
import { createClient } from "@nkps/shared/lib/supabase/client";
import { Badge } from "@nkps/shared/components/ui/badge";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@nkps/shared/components/ui/card";
import {
  Progress,
  ProgressLabel,
  ProgressValue,
} from "@nkps/shared/components/ui/progress";
import {
  ClipboardCheck,
  CalendarDays,
  CheckCircle2,
  XCircle,
  Clock,
  TrendingUp,
} from "lucide-react";
import type { AttendanceStatus } from "@nkps/shared/types";

interface AttendanceRecord {
  date: string;
  status: AttendanceStatus;
}

interface MonthlyBreakdown {
  month: string;
  label: string;
  present: number;
  absent: number;
  late: number;
  total: number;
}

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const CALENDAR_COLORS: Record<string, string> = {
  present: "bg-green-100 dark:bg-green-950/30 text-green-700 dark:text-green-400 border-green-200 dark:border-green-800",
  absent: "bg-red-100 dark:bg-red-950/30 text-red-700 dark:text-red-400 border-red-200 dark:border-red-800",
  late: "bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-400 border-yellow-200 dark:border-yellow-800",
};

export default function StudentAttendancePage() {
  const [records, setRecords] = useState<AttendanceRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentMonth, setCurrentMonth] = useState(() => new Date());

  useEffect(() => {
    async function fetchAttendance() {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) return;

      // Resolve linked student record ID
      const { data: profile } = await supabase
        .from("profiles")
        .select("student_id")
        .eq("id", user.id)
        .single();

      const studentId = profile?.student_id;
      if (!studentId) {
        setLoading(false);
        return;
      }

      // Get enrollment
      const { data: enrollment } = await supabase
        .from("student_enrollments")
        .select("class_id")
        .eq("student_id", studentId)
        .limit(1)
        .single();

      if (!enrollment) {
        setLoading(false);
        return;
      }

      // Get current academic year
      const { data: academicYear } = await supabase
        .from("academic_years")
        .select("start_date, end_date")
        .eq("is_current", true)
        .limit(1)
        .single();

      // Fetch attendance records
      let query = supabase
        .from("attendance")
        .select("date, status")
        .eq("student_id", studentId)
        .eq("class_id", enrollment.class_id)
        .order("date", { ascending: true });

      if (academicYear) {
        query = query
          .gte("date", academicYear.start_date)
          .lte("date", academicYear.end_date);
      }

      const { data } = await query;
      setRecords((data as AttendanceRecord[]) ?? []);
      setLoading(false);
    }

    fetchAttendance();
  }, []);

  // Compute stats
  const totalDays = records.length;
  const presentDays = records.filter((r) => r.status === "present").length;
  const absentDays = records.filter((r) => r.status === "absent").length;
  const lateDays = records.filter((r) => r.status === "late").length;
  const attendancePercent =
    totalDays > 0 ? Math.round(((presentDays + lateDays) / totalDays) * 100) : 0;

  // Monthly breakdown
  const monthlyData: MonthlyBreakdown[] = (() => {
    const map = new Map<string, MonthlyBreakdown>();
    for (const r of records) {
      const d = new Date(r.date);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      if (!map.has(key)) {
        map.set(key, {
          month: key,
          label: `${MONTH_NAMES[d.getMonth()]} ${d.getFullYear()}`,
          present: 0,
          absent: 0,
          late: 0,
          total: 0,
        });
      }
      const entry = map.get(key)!;
      entry.total++;
      if (r.status === "present") entry.present++;
      else if (r.status === "absent") entry.absent++;
      else if (r.status === "late") entry.late++;
    }
    return Array.from(map.values());
  })();

  // Calendar view helpers
  const calendarYear = currentMonth.getFullYear();
  const calendarMonth = currentMonth.getMonth();
  const firstDay = new Date(calendarYear, calendarMonth, 1).getDay();
  const daysInMonth = new Date(calendarYear, calendarMonth + 1, 0).getDate();

  const attendanceMap = new Map(records.map((r) => [r.date, r.status]));

  const navigateMonth = (delta: number) => {
    setCurrentMonth((prev) => {
      const next = new Date(prev);
      next.setMonth(next.getMonth() + delta);
      return next;
    });
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-navy-900 border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="font-heading text-2xl font-bold text-navy-900 dark:text-white">
          My Attendance
        </h1>
        <p className="text-gray-500 dark:text-gray-400 mt-1">
          Track your attendance across the academic year.
        </p>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <Card className="erp-card">
          <CardContent className="p-4 text-center">
            <CalendarDays className="h-5 w-5 text-gold-500 mx-auto mb-1" />
            <p className="text-2xl font-bold text-navy-900 dark:text-white">{totalDays}</p>
            <p className="text-xs text-gray-500 dark:text-gray-400">Total Days</p>
          </CardContent>
        </Card>
        <Card className="erp-card">
          <CardContent className="p-4 text-center">
            <CheckCircle2 className="h-5 w-5 text-green-500 mx-auto mb-1" />
            <p className="text-2xl font-bold text-green-700 dark:text-green-400">{presentDays}</p>
            <p className="text-xs text-gray-500 dark:text-gray-400">Present</p>
          </CardContent>
        </Card>
        <Card className="erp-card">
          <CardContent className="p-4 text-center">
            <XCircle className="h-5 w-5 text-red-500 mx-auto mb-1" />
            <p className="text-2xl font-bold text-red-700 dark:text-red-400">{absentDays}</p>
            <p className="text-xs text-gray-500 dark:text-gray-400">Absent</p>
          </CardContent>
        </Card>
        <Card className="erp-card">
          <CardContent className="p-4 text-center">
            <Clock className="h-5 w-5 text-yellow-500 mx-auto mb-1" />
            <p className="text-2xl font-bold text-yellow-700 dark:text-yellow-400">{lateDays}</p>
            <p className="text-xs text-gray-500 dark:text-gray-400">Late</p>
          </CardContent>
        </Card>
        <Card className="erp-card col-span-2 md:col-span-1">
          <CardContent className="p-4 text-center">
            <TrendingUp className="h-5 w-5 text-gold-500 mx-auto mb-1" />
            <p className="text-2xl font-bold text-navy-900 dark:text-white">{attendancePercent}%</p>
            <p className="text-xs text-gray-500 dark:text-gray-400">Attendance</p>
          </CardContent>
        </Card>
      </div>

      {/* Attendance Progress Bar */}
      <Card className="erp-card">
        <CardContent className="p-6">
          <Progress value={attendancePercent}>
            <ProgressLabel>Overall Attendance</ProgressLabel>
            <ProgressValue />
          </Progress>
        </CardContent>
      </Card>

      {/* Calendar View */}
      <Card className="erp-card">
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-navy-900 dark:text-white">
            <CalendarDays className="h-5 w-5 text-gold-500" />
            {MONTH_NAMES[calendarMonth]} {calendarYear}
          </CardTitle>
          <div className="flex gap-2">
            <button
              onClick={() => navigateMonth(-1)}
              className="px-3 py-1 rounded-md text-sm bg-gray-100 dark:bg-muted hover:bg-gray-200 dark:hover:bg-muted text-gray-700 dark:text-gray-200"
            >
              Prev
            </button>
            <button
              onClick={() => navigateMonth(1)}
              className="px-3 py-1 rounded-md text-sm bg-gray-100 dark:bg-muted hover:bg-gray-200 dark:hover:bg-muted text-gray-700 dark:text-gray-200"
            >
              Next
            </button>
          </div>
        </CardHeader>
        <CardContent>
          {/* Legend */}
          <div className="flex gap-4 mb-4 text-xs">
            <span className="flex items-center gap-1">
              <span className="w-3 h-3 rounded-sm bg-green-100 dark:bg-green-950/30 border border-green-200 dark:border-border" />
              Present
            </span>
            <span className="flex items-center gap-1">
              <span className="w-3 h-3 rounded-sm bg-red-100 dark:bg-red-950/30 border border-red-200 dark:border-border" />
              Absent
            </span>
            <span className="flex items-center gap-1">
              <span className="w-3 h-3 rounded-sm bg-yellow-100 dark:bg-yellow-900/30 border border-yellow-200 dark:border-border" />
              Late
            </span>
            <span className="flex items-center gap-1">
              <span className="w-3 h-3 rounded-sm bg-gray-100 dark:bg-muted border border-gray-200 dark:border-border" />
              No Data
            </span>
          </div>

          {/* Day headers */}
          <div className="grid grid-cols-7 gap-1 mb-1">
            {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
              <div key={d} className="text-center text-xs font-medium text-gray-500 dark:text-gray-400 py-1">
                {d}
              </div>
            ))}
          </div>

          {/* Calendar grid */}
          <div className="grid grid-cols-7 gap-1">
            {/* Empty cells for first week offset */}
            {Array.from({ length: firstDay }).map((_, i) => (
              <div key={`empty-${i}`} className="aspect-square" />
            ))}
            {/* Day cells */}
            {Array.from({ length: daysInMonth }).map((_, i) => {
              const day = i + 1;
              const dateStr = `${calendarYear}-${String(calendarMonth + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
              const status = attendanceMap.get(dateStr);
              const colorClass = status
                ? CALENDAR_COLORS[status]
                : "bg-gray-50 dark:bg-muted text-gray-400 dark:text-gray-500 border-gray-100 dark:border-border";

              return (
                <div
                  key={day}
                  className={`aspect-square flex items-center justify-center rounded-md text-xs font-medium border ${colorClass}`}
                >
                  {day}
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* Monthly Breakdown */}
      {monthlyData.length > 0 && (
        <Card className="erp-card">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-navy-900 dark:text-white">
              <ClipboardCheck className="h-5 w-5 text-gold-500" />
              Monthly Breakdown
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {monthlyData.map((m) => {
                const monthPercent =
                  m.total > 0
                    ? Math.round(((m.present + m.late) / m.total) * 100)
                    : 0;
                return (
                  <div
                    key={m.month}
                    className="flex items-center gap-4 py-2 border-b border-gray-100 dark:border-border last:border-0"
                  >
                    <span className="w-36 text-sm font-medium text-navy-900 dark:text-white">
                      {m.label}
                    </span>
                    <div className="flex-1 flex items-center gap-2">
                      <div className="flex-1 h-2 bg-gray-100 dark:bg-muted rounded-full overflow-hidden">
                        <div
                          className="h-full bg-green-500 rounded-full transition-all"
                          style={{ width: `${monthPercent}%` }}
                        />
                      </div>
                      <span className="text-xs font-medium text-gray-600 dark:text-gray-300 w-10 text-right">
                        {monthPercent}%
                      </span>
                    </div>
                    <div className="flex gap-2">
                      <Badge className="bg-green-100 dark:bg-green-950/30 text-green-700 dark:text-green-400 text-xs">
                        P:{m.present}
                      </Badge>
                      <Badge className="bg-red-100 dark:bg-red-950/30 text-red-700 dark:text-red-400 text-xs">
                        A:{m.absent}
                      </Badge>
                      <Badge className="bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-400 text-xs">
                        L:{m.late}
                      </Badge>
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {totalDays === 0 && (
        <Card className="erp-card">
          <CardContent className="flex items-center justify-center py-12">
            <div className="text-center text-gray-400 dark:text-gray-500">
              <ClipboardCheck className="h-10 w-10 mx-auto mb-3 opacity-50" />
              <p className="text-sm">No attendance records found</p>
              <p className="text-xs text-gray-300 dark:text-gray-500 mt-1">
                Records will appear here once your teacher marks attendance
              </p>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
