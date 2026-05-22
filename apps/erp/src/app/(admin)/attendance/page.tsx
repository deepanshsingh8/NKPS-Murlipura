"use client";

import { useEffect, useState, useCallback } from "react";
import { createClient } from "@nkps/shared/lib/supabase/client";
import { useUrlState } from "@nkps/shared/lib/hooks/use-url-state";
import { Badge } from "@nkps/shared/components/ui/badge";
import { Input } from "@nkps/shared/components/ui/input";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@nkps/shared/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@nkps/shared/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@nkps/shared/components/ui/table";
import {
  ClipboardCheck,
  Users,
  CheckCircle2,
  XCircle,
  Loader2,
  BarChart3,
} from "lucide-react";
import { formatClassName } from "@nkps/shared/lib/utils";

interface ClassOption {
  id: string;
  name: string;
  section: string;
  streams?: { name: string } | null;
}

interface ClassAttendanceStat {
  classId: string;
  className: string;
  section: string;
  totalStudents: number;
  totalRecords: number;
  presentCount: number;
  absentCount: number;
  lateCount: number;
  attendancePercent: number;
}

export default function AdminAttendancePage() {
  const [classes, setClasses] = useState<ClassOption[]>([]);
  // Filter state lives in the URL so back-navigation restores it (UX-1).
  const [selectedClassId, setSelectedClassId] = useUrlState("class_id", "all");
  const defaultDateFrom = (() => {
    const d = new Date();
    d.setDate(1); // first day of current month
    return d.toISOString().split("T")[0];
  })();
  const defaultDateTo = new Date().toISOString().split("T")[0];
  const [dateFrom, setDateFrom] = useUrlState("from", defaultDateFrom);
  const [dateTo, setDateTo] = useUrlState("to", defaultDateTo);
  const [classStats, setClassStats] = useState<ClassAttendanceStat[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingStats, setLoadingStats] = useState(false);

  // Summary
  const [totalStudents, setTotalStudents] = useState(0);
  const [presentToday, setPresentToday] = useState(0);
  const [absentToday, setAbsentToday] = useState(0);

  const supabase = createClient();

  // Fetch all classes
  useEffect(() => {
    async function fetchClasses() {
      const { data } = await supabase
        .from("classes")
        .select("id, name, section, streams:stream_id(name)")
        .order("sort_order");

      setClasses((data as unknown as ClassOption[]) ?? []);
      setLoading(false);
    }

    fetchClasses();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Fetch today's summary stats
  useEffect(() => {
    async function fetchTodaySummary() {
      const today = new Date().toISOString().split("T")[0];

      // Total enrolled students
      const { count: studentCount } = await supabase
        .from("student_enrollments")
        .select("*", { count: "exact", head: true });
      setTotalStudents(studentCount ?? 0);

      // Present today
      const { count: pCount } = await supabase
        .from("attendance")
        .select("*", { count: "exact", head: true })
        .eq("date", today)
        .in("status", ["present", "late"]);
      setPresentToday(pCount ?? 0);

      // Absent today
      const { count: aCount } = await supabase
        .from("attendance")
        .select("*", { count: "exact", head: true })
        .eq("date", today)
        .eq("status", "absent");
      setAbsentToday(aCount ?? 0);
    }

    fetchTodaySummary();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Fetch class-wise stats for date range
  const fetchClassStats = useCallback(async () => {
    setLoadingStats(true);

    const targetClasses =
      selectedClassId === "all"
        ? classes
        : classes.filter((c) => c.id === selectedClassId);

    const stats: ClassAttendanceStat[] = [];

    for (const cls of targetClasses) {
      // Get enrolled student count
      const { count: studentCount } = await supabase
        .from("student_enrollments")
        .select("*", { count: "exact", head: true })
        .eq("class_id", cls.id);

      // Get attendance in date range
      const { data: attendanceData } = await supabase
        .from("attendance")
        .select("status")
        .eq("class_id", cls.id)
        .gte("date", dateFrom)
        .lte("date", dateTo);

      const records = attendanceData ?? [];
      const present = records.filter(
        (r) => r.status === "present" || r.status === "late"
      ).length;
      const absent = records.filter((r) => r.status === "absent").length;
      const late = records.filter((r) => r.status === "late").length;

      stats.push({
        classId: cls.id,
        className: cls.name,
        section: cls.section,
        totalStudents: studentCount ?? 0,
        totalRecords: records.length,
        presentCount: present,
        absentCount: absent,
        lateCount: late,
        attendancePercent:
          records.length > 0 ? Math.round((present / records.length) * 100) : 0,
      });
    }

    setClassStats(stats);
    setLoadingStats(false);
  }, [classes, selectedClassId, dateFrom, dateTo, supabase]);

  // Auto-fetch when classes load or filters change
  useEffect(() => {
    if (classes.length > 0) {
      fetchClassStats();
    }
  }, [classes, selectedClassId, dateFrom, dateTo, fetchClassStats]);

  const avgAttendance =
    classStats.length > 0
      ? Math.round(
          classStats.reduce((sum, s) => sum + s.attendancePercent, 0) /
            classStats.length
        )
      : 0;

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
          Attendance Reports
        </h1>
        <p className="text-gray-500 dark:text-gray-400 mt-1">
          Overview of attendance across all classes.
        </p>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card className="erp-card">
          <CardContent className="p-4 text-center">
            <Users className="h-5 w-5 text-gold-500 mx-auto mb-1" />
            <p className="text-2xl font-bold text-navy-900 dark:text-white">{totalStudents}</p>
            <p className="text-xs text-gray-500 dark:text-gray-400">Total Students</p>
          </CardContent>
        </Card>
        <Card className="erp-card">
          <CardContent className="p-4 text-center">
            <BarChart3 className="h-5 w-5 text-gold-500 mx-auto mb-1" />
            <p className="text-2xl font-bold text-navy-900 dark:text-white">{avgAttendance}%</p>
            <p className="text-xs text-gray-500 dark:text-gray-400">Avg Attendance</p>
          </CardContent>
        </Card>
        <Card className="erp-card">
          <CardContent className="p-4 text-center">
            <CheckCircle2 className="h-5 w-5 text-green-500 mx-auto mb-1" />
            <p className="text-2xl font-bold text-green-700 dark:text-green-400">{presentToday}</p>
            <p className="text-xs text-gray-500 dark:text-gray-400">Present Today</p>
          </CardContent>
        </Card>
        <Card className="erp-card">
          <CardContent className="p-4 text-center">
            <XCircle className="h-5 w-5 text-red-500 mx-auto mb-1" />
            <p className="text-2xl font-bold text-red-700 dark:text-red-400">{absentToday}</p>
            <p className="text-xs text-gray-500 dark:text-gray-400">Absent Today</p>
          </CardContent>
        </Card>
      </div>

      {/* Filter Bar */}
      <Card className="erp-card">
        <CardContent className="p-6">
          <div className="flex flex-col sm:flex-row gap-4">
            <div className="flex-1">
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">
                Class
              </label>
              <Select
                value={selectedClassId}
                items={[
                  { value: "all", label: "All Classes" },
                  ...classes.map((c) => ({ value: c.id, label: formatClassName(c) })),
                ]}
                onValueChange={(val) => val && setSelectedClassId(val)}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="All Classes" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Classes</SelectItem>
                  {classes.map((c) => (
                    <SelectItem key={c.id} value={c.id} label={formatClassName(c)}>
                      {formatClassName(c)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="sm:w-44">
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">
                From
              </label>
              <Input
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
              />
            </div>
            <div className="sm:w-44">
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">
                To
              </label>
              <Input
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Class-wise Table */}
      <Card className="erp-card">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-navy-900 dark:text-white">
            <ClipboardCheck className="h-5 w-5 text-gold-500" />
            Class-wise Attendance
          </CardTitle>
        </CardHeader>
        <CardContent>
          {loadingStats ? (
            <div className="flex justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-gray-400 dark:text-gray-500" />
            </div>
          ) : classStats.length === 0 ? (
            <p className="text-center py-12 text-gray-500 dark:text-gray-400">
              No classes found.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Class</TableHead>
                  <TableHead className="text-center">Students</TableHead>
                  <TableHead className="text-center">Records</TableHead>
                  <TableHead className="text-center">Present</TableHead>
                  <TableHead className="text-center">Absent</TableHead>
                  <TableHead className="text-center">Late</TableHead>
                  <TableHead className="text-center">Attendance %</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {classStats.map((stat) => (
                  <TableRow key={stat.classId}>
                    <TableCell className="font-medium">
                      {stat.className} - {stat.section}
                    </TableCell>
                    <TableCell className="text-center">
                      {stat.totalStudents}
                    </TableCell>
                    <TableCell className="text-center text-gray-500 dark:text-gray-400">
                      {stat.totalRecords}
                    </TableCell>
                    <TableCell className="text-center">
                      <Badge className="bg-green-100 dark:bg-green-950/30 text-green-700 dark:text-green-400 text-xs">
                        {stat.presentCount}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-center">
                      <Badge className="bg-red-100 dark:bg-red-950/30 text-red-700 dark:text-red-400 text-xs">
                        {stat.absentCount}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-center">
                      <Badge className="bg-yellow-100 dark:bg-yellow-950/30 text-yellow-700 dark:text-yellow-400 text-xs">
                        {stat.lateCount}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-center">
                      <div className="flex items-center justify-center gap-2">
                        <div className="w-16 h-2 bg-gray-100 dark:bg-muted rounded-full overflow-hidden">
                          <div
                            className={`h-full rounded-full transition-all ${
                              stat.attendancePercent >= 75
                                ? "bg-green-500"
                                : stat.attendancePercent >= 50
                                  ? "bg-yellow-500"
                                  : "bg-red-500"
                            }`}
                            style={{
                              width: `${stat.attendancePercent}%`,
                            }}
                          />
                        </div>
                        <span
                          className={`text-sm font-medium ${
                            stat.attendancePercent >= 75
                              ? "text-green-700 dark:text-green-400"
                              : stat.attendancePercent >= 50
                                ? "text-yellow-700 dark:text-yellow-400"
                                : "text-red-700 dark:text-red-400"
                          }`}
                        >
                          {stat.attendancePercent}%
                        </span>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
