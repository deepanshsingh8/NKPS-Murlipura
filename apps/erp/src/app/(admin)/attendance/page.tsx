"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import { createClient } from "@nkps/shared/lib/supabase/client";
import { firstDayOfMonthISO, todayISO } from "@nkps/shared/lib/date";
import { useUrlState } from "@nkps/shared/lib/hooks/use-url-state";
import { Badge } from "@nkps/shared/components/ui/badge";
import { AcademicSessionPicker } from "@nkps/shared/components/AcademicSessionPicker";
import { useAcademicSession } from "@nkps/shared/lib/hooks/use-academic-session";
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
  SortFilterHead,
  TableFilterSummary,
  useTableControls,
  type TableColumns,
} from "@nkps/shared/components/ui/data-table";
import { TableExportButton } from "@nkps/shared/components/ui/table-export-button";
import {
  ClipboardCheck,
  Users,
  CheckCircle2,
  XCircle,
  Loader2,
  BarChart3,
} from "lucide-react";
import { formatClassName } from "@nkps/shared/lib/utils";
import { fetchAllRows } from "@nkps/shared/lib/fetch-all-rows";
import { toast } from "sonner";


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
  // Both anchored on the school's civil date. Mutating a Date with
  // setDate(1) and converting with toISOString() afterwards returned the
  // PREVIOUS month's last day when opened before 05:30 IST.
  const defaultDateFrom = firstDayOfMonthISO();
  const defaultDateTo = todayISO();
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
  const session = useAcademicSession();
  const sessionId = session.sessionId;

  useEffect(() => {
    async function fetchClasses() {
      const { data } = await supabase
        .from("classes")
        .select("id, name, section, streams:stream_id(name)")
        // Classes belong to a session. Without this the register offers this
        // year's classes while showing a past year's dates, which is a class
        // list that never had those students in it.
        .eq(
          "academic_year_id",
          sessionId ?? "00000000-0000-0000-0000-000000000000"
        )
        .order("sort_order");

      setClasses((data as unknown as ClassOption[]) ?? []);
      setLoading(false);
    }

    fetchClasses();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  // Fetch today's summary stats
  useEffect(() => {
    async function fetchTodaySummary() {
      const today = todayISO();

      // The three counts have nothing to say to each other, so they go out
      // together — awaited in sequence the card row cost three round trips
      // before any of it rendered.
      const [studentRes, presentRes, absentRes] = await Promise.all([
        // Total enrolled students
        supabase
          .from("student_enrollments")
          .select("*", { count: "exact", head: true }),
        // Present today
        supabase
          .from("attendance")
          .select("*", { count: "exact", head: true })
          .eq("date", today)
          .in("status", ["present", "late"]),
        // Absent today
        supabase
          .from("attendance")
          .select("*", { count: "exact", head: true })
          .eq("date", today)
          .eq("status", "absent"),
      ]);

      setTotalStudents(studentRes.count ?? 0);
      setPresentToday(presentRes.count ?? 0);
      setAbsentToday(absentRes.count ?? 0);
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

    const classIds = targetClasses.map((c) => c.id);

    // An empty `.in()` list is not a query PostgREST will accept, and there is
    // nothing to report anyway (a stale class_id in the URL lands here).
    if (classIds.length === 0) {
      setClassStats([]);
      setLoadingStats(false);
      return;
    }

    // One read per table for every class at once, grouped in JS below. Asking
    // per class was two serial round trips each: a full school's 32 classes
    // spent ~10s here against ~0.5s for the pair.
    const [enrollmentRes, attendanceRes] = await Promise.all([
      // TODO: unfiltered by status, so an exited student still counts toward
      // the class roster here — the teacher dashboard counts only 'active'.
      // Left as-is: this refactor is not changing what the numbers mean.
      fetchAllRows<{ class_id: string }>((from, to) =>
        supabase
          .from("student_enrollments")
          .select("class_id")
          .in("class_id", classIds)
          .order("id", { ascending: true })
          .range(from, to)
      ),
      // A term-long range over every class runs to tens of thousands of rows.
      // `.range(0, 99999)` did not lift PostgREST's 1000-row cap — a Range
      // header can only ask for less than the cap — so this table was drawn
      // from the first thousand marks of the term and under-reported every
      // class, with no error to notice. Paged, and ordered by id so the pages
      // are disjoint.
      fetchAllRows<{ class_id: string; status: string }>((from, to) =>
        supabase
          .from("attendance")
          .select("class_id, status")
          .in("class_id", classIds)
          .gte("date", dateFrom)
          .lte("date", dateTo)
          .order("id", { ascending: true })
          .range(from, to)
      ),
    ]);

    // A read that failed or stopped short would show up as a low percentage
    // rather than as an error, so it is reported and nothing is drawn.
    if (
      enrollmentRes.error ||
      enrollmentRes.truncated ||
      attendanceRes.error ||
      attendanceRes.truncated
    ) {
      console.error(
        "Attendance stats read failed:",
        enrollmentRes.error ?? attendanceRes.error ?? "read stopped at the paging guard"
      );
      toast.error("Could not load attendance figures");
      setClassStats([]);
      setLoadingStats(false);
      return;
    }

    const enrolledByClass = new Map<string, number>();
    for (const row of enrollmentRes.data ?? []) {
      enrolledByClass.set(
        row.class_id,
        (enrolledByClass.get(row.class_id) ?? 0) + 1
      );
    }

    interface Tally {
      total: number;
      present: number;
      absent: number;
      late: number;
    }
    const tallyByClass = new Map<string, Tally>();
    for (const row of attendanceRes.data ?? []) {
      let tally = tallyByClass.get(row.class_id);
      if (!tally) {
        tally = { total: 0, present: 0, absent: 0, late: 0 };
        tallyByClass.set(row.class_id, tally);
      }
      tally.total += 1;
      // A late arrival still attended, so it counts as present here and is
      // reported again on its own in the Late column.
      if (row.status === "present" || row.status === "late") tally.present += 1;
      if (row.status === "absent") tally.absent += 1;
      if (row.status === "late") tally.late += 1;
    }

    const stats: ClassAttendanceStat[] = targetClasses.map((cls) => {
      const tally = tallyByClass.get(cls.id);
      const totalRecords = tally?.total ?? 0;
      const present = tally?.present ?? 0;

      return {
        classId: cls.id,
        className: cls.name,
        section: cls.section,
        totalStudents: enrolledByClass.get(cls.id) ?? 0,
        totalRecords,
        presentCount: present,
        absentCount: tally?.absent ?? 0,
        lateCount: tally?.late ?? 0,
        attendancePercent:
          totalRecords > 0 ? Math.round((present / totalRecords) * 100) : 0,
      };
    });

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

  // Header sort/filter accessors — mirror what the matching cell renders.
  const columns = useMemo<TableColumns<ClassAttendanceStat>>(
    () => ({
      class: { label: "Class", value: (s) => `${s.className} - ${s.section}` },
      students: {
        label: "Students",
        value: (s) => s.totalStudents,
        filter: "none",
      },
      records: {
        label: "Records",
        value: (s) => s.totalRecords,
        filter: "none",
      },
      present: {
        label: "Present",
        value: (s) => s.presentCount,
        filter: "none",
      },
      absent: { label: "Absent", value: (s) => s.absentCount, filter: "none" },
      late: { label: "Late", value: (s) => s.lateCount, filter: "none" },
      percent: {
        label: "Attendance %",
        value: (s) => `${s.attendancePercent}%`,
        sortValue: (s) => s.attendancePercent,
      },
    }),
    []
  );

  const table = useTableControls({ rows: classStats, columns });

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
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-heading text-2xl font-bold text-navy-900 dark:text-white">
            Attendance Reports
          </h1>
          <p className="text-gray-500 dark:text-gray-400 mt-1">
            Overview of attendance across all classes.
          </p>
        </div>
        <AcademicSessionPicker state={session} />
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
            <>
            <div className="mb-3 flex flex-wrap items-center justify-end gap-2">
              <TableFilterSummary
                ctl={table}
                total={classStats.length}
                shown={table.rows.length}
                className="mb-0 mr-auto"
            />
              <TableExportButton
                ctl={table}
                filename="attendance-summary"
                title="Attendance Summary"
                featureKey="attendance"
              />
            </div>
            <Table>
              <TableHeader>
                <TableRow>
                  <SortFilterHead ctl={table} col="class" />
                  <SortFilterHead ctl={table} col="students" align="center" />
                  <SortFilterHead ctl={table} col="records" align="center" />
                  <SortFilterHead ctl={table} col="present" align="center" />
                  <SortFilterHead ctl={table} col="absent" align="center" />
                  <SortFilterHead ctl={table} col="late" align="center" />
                  <SortFilterHead ctl={table} col="percent" align="center" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {table.rows.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={7} className="py-10 text-center text-gray-500 dark:text-gray-400">
                      No classes match the column filters.
                    </TableCell>
                  </TableRow>
                )}
                {table.rows.map((stat) => (
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
                      <Badge className="bg-amber-100 dark:bg-amber-950/30 text-amber-700 dark:text-amber-400 text-xs">
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
                                  ? "bg-amber-500"
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
                                ? "text-amber-700 dark:text-amber-400"
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
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
