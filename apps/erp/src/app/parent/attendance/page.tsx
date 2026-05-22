"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
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
  Users,
} from "lucide-react";
import type { AttendanceStatus } from "@nkps/shared/types";

interface ChildOption {
  student_id: string;
  full_name: string;
  class_name: string | null;
  section: string | null;
}

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

export default function ParentAttendancePage() {
  const searchParams = useSearchParams();
  const preselectedChild = searchParams.get("child");

  const [children, setChildren] = useState<ChildOption[]>([]);
  const [selectedChild, setSelectedChild] = useState<string>("");
  const [records, setRecords] = useState<AttendanceRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingRecords, setLoadingRecords] = useState(false);
  const [currentMonth, setCurrentMonth] = useState(() => new Date());

  // Fetch children on mount
  useEffect(() => {
    async function fetchChildren() {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;

      const { data: profile } = await supabase
        .from("profiles")
        .select("parent_id")
        .eq("id", user.id)
        .single();

      const parentId = profile?.parent_id;
      if (!parentId) {
        setLoading(false);
        return;
      }

      const { data: studentParents } = await supabase
        .from("student_parents")
        .select("student_id, students(id, full_name)")
        .eq("parent_id", parentId);

      if (!studentParents || studentParents.length === 0) {
        setLoading(false);
        return;
      }

      const childOptions: ChildOption[] = [];
      for (const sp of studentParents) {
        const student = sp.students as unknown as {
          id: string;
          full_name: string;
        };
        if (!student) continue;

        const { data: enrollment } = await supabase
          .from("student_enrollments")
          .select("classes(name, section)")
          .eq("student_id", student.id)
          .limit(1)
          .single();

        const classInfo = enrollment?.classes as unknown as {
          name: string;
          section: string;
        } | null;

        childOptions.push({
          student_id: student.id,
          full_name: student.full_name,
          class_name: classInfo?.name ?? null,
          section: classInfo?.section ?? null,
        });
      }

      setChildren(childOptions);

      // Auto-select from query param or first child
      const initial = preselectedChild && childOptions.some((c) => c.student_id === preselectedChild)
        ? preselectedChild
        : childOptions[0]?.student_id ?? "";
      setSelectedChild(initial);
      setLoading(false);
    }

    fetchChildren();
  }, [preselectedChild]);

  // Fetch attendance when selected child changes
  useEffect(() => {
    if (!selectedChild) return;

    async function fetchAttendance() {
      setLoadingRecords(true);
      const supabase = createClient();

      const { data: enrollment } = await supabase
        .from("student_enrollments")
        .select("class_id")
        .eq("student_id", selectedChild)
        .limit(1)
        .single();

      if (!enrollment) {
        setRecords([]);
        setLoadingRecords(false);
        return;
      }

      const { data: academicYear } = await supabase
        .from("academic_years")
        .select("start_date, end_date")
        .eq("is_current", true)
        .limit(1)
        .single();

      let query = supabase
        .from("attendance")
        .select("date, status")
        .eq("student_id", selectedChild)
        .eq("class_id", enrollment.class_id)
        .order("date", { ascending: true });

      if (academicYear) {
        query = query
          .gte("date", academicYear.start_date)
          .lte("date", academicYear.end_date);
      }

      const { data } = await query;
      setRecords((data as AttendanceRecord[]) ?? []);
      setLoadingRecords(false);
    }

    fetchAttendance();
  }, [selectedChild]);

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

  const selectedChildInfo = children.find((c) => c.student_id === selectedChild);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-4">
        <div>
          <h1 className="font-heading text-2xl font-bold text-navy-900 dark:text-white">
            Attendance
          </h1>
          <p className="text-gray-500 dark:text-gray-400 mt-1">
            Track your child&apos;s attendance across the academic year.
          </p>
        </div>

        {/* Child Selector */}
        {children.length > 1 && (
          <div className="flex items-center gap-2">
            <Users className="h-4 w-4 text-gray-400" />
            <select
              value={selectedChild}
              onChange={(e) => setSelectedChild(e.target.value)}
              className="rounded-lg border border-gray-200 dark:border-border bg-white dark:bg-card px-3 py-2 text-sm text-navy-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-gold-500"
            >
              {children.map((child) => (
                <option key={child.student_id} value={child.student_id}>
                  {child.full_name}
                  {child.class_name ? ` (${child.class_name} - ${child.section})` : ""}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {selectedChildInfo && children.length <= 1 && (
        <p className="text-sm text-gray-500 dark:text-gray-400">
          Showing attendance for <span className="font-medium text-navy-900 dark:text-white">{selectedChildInfo.full_name}</span>
          {selectedChildInfo.class_name && ` | ${selectedChildInfo.class_name} - ${selectedChildInfo.section}`}
        </p>
      )}

      {loadingRecords ? (
        <div className="flex items-center justify-center h-32">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-navy-900 border-t-transparent" />
        </div>
      ) : (
        <>
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
                {Array.from({ length: firstDay }).map((_, i) => (
                  <div key={`empty-${i}`} className="aspect-square" />
                ))}
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
                    Records will appear here once the teacher marks attendance
                  </p>
                </div>
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
