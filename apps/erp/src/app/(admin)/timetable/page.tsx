"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { createClient } from "@nkps/shared/lib/supabase/client";
import { useUrlState } from "@nkps/shared/lib/hooks/use-url-state";
import { Button } from "@nkps/shared/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@nkps/shared/components/ui/dropdown-menu";
import { AcademicSessionPicker } from "@nkps/shared/components/AcademicSessionPicker";
import { useAcademicSession } from "@nkps/shared/lib/hooks/use-academic-session";
import { Input } from "@nkps/shared/components/ui/input";
import { Label } from "@nkps/shared/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@nkps/shared/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@nkps/shared/components/ui/select";
import { toast } from "sonner";
import { Plus, Trash2, Loader2, Clock, CalendarRange, Info, Printer, ChevronDown } from "lucide-react";
import { adminApi, adminFetch } from "@nkps/shared/lib/admin-api";
import { formatClassName, formatShortDate } from "@nkps/shared/lib/utils";
import { teacherOptions } from "@nkps/shared/lib/teacher-options";
import type { Class, Subject, Teacher, TimetablePeriod } from "@nkps/shared/types";
import { NativeSelect } from "@nkps/shared/components/ui/native-select";

function defaultDay(): number {
  const today = new Date().getDay(); // 0 = Sunday
  return today >= 1 && today <= 6 ? today : 1;
}

const DAYS = [
  { value: 1, label: "Monday" },
  { value: 2, label: "Tuesday" },
  { value: 3, label: "Wednesday" },
  { value: 4, label: "Thursday" },
  { value: 5, label: "Friday" },
  { value: 6, label: "Saturday" },
];

const DEFAULT_PERIODS = [
  { num: 1, start: "08:00", end: "08:45" },
  { num: 2, start: "08:45", end: "09:30" },
  { num: 3, start: "09:30", end: "10:15" },
  { num: 4, start: "10:30", end: "11:15" },
  { num: 5, start: "11:15", end: "12:00" },
  { num: 6, start: "12:45", end: "01:30" },
  { num: 7, start: "01:30", end: "02:15" },
  { num: 8, start: "02:15", end: "03:00" },
];

// Suggested times for a period row when no stored period exists yet. Period 0
// is the zero/pre-first period, so it sits before P1.
function periodTimeDefaults(num: number): { start: string; end: string } {
  const def = DEFAULT_PERIODS.find((p) => p.num === num);
  if (def) return { start: def.start, end: def.end };
  if (num === 0) return { start: "07:15", end: "08:00" };
  return { start: "08:00", end: "08:45" };
}

interface PeriodCell extends TimetablePeriod {
  subject_name?: string;
  teacher_name?: string;
}

interface AcademicYearInfo {
  id: string;
  name: string;
  start_date: string;
  end_date: string;
}

export default function AdminTimetablePage() {
  const supabase = createClient();

  const [classes, setClasses] = useState<Class[]>([]);
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [teachers, setTeachers] = useState<Teacher[]>([]);
  const [periods, setPeriods] = useState<PeriodCell[]>([]);
  const [academicYear, setAcademicYear] = useState<AcademicYearInfo | null>(null);

  // Filter state lives in the URL so back-navigation restores it (UX-1).
  const [selectedClassId, setSelectedClassId] = useUrlState("class_id");
  const [loading, setLoading] = useState(true);
  const [periodsLoading, setPeriodsLoading] = useState(false);

  const [mobileDay, setMobileDay] = useState(defaultDay);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  // Period rows the admin added on top of the defaults (a zero period, or
  // periods beyond the default 8) so they have a row to click into.
  const [extraPeriodNums, setExtraPeriodNums] = useState<number[]>([]);
  const [formData, setFormData] = useState({
    day_of_week: "1",
    period_number: "1",
    subject_id: "",
    teacher_id: "",
    start_time: "08:00",
    end_time: "08:45",
    room: "",
    // migration 119 — which parallel track of the cell this is, what to call
    // it, and whether the teacher is legitimately with several classes at once.
    group_no: 0,
    group_label: "",
    is_shared: false,
  });

const session = useAcademicSession();
  const sessionId = session.sessionId;

    useEffect(() => {
    async function fetchData() {
      // Period templates and teacher assignments are year-scoped, so the
      // grid follows the session picker.
      let yearQuery = supabase
        .from("academic_years")
        .select("id, name, start_date, end_date");
      yearQuery = sessionId
        ? yearQuery.eq("id", sessionId)
        : yearQuery.eq("is_current", true);
      const { data: currentYear } = await yearQuery.maybeSingle();

      if (currentYear) {
        setAcademicYear(currentYear as AcademicYearInfo);
      }

      const [classesRes, subjectsRes, teachersRes] = await Promise.all([
        supabase
          .from("classes")
          .select("*, streams:stream_id(name)")
          .eq(
            "academic_year_id",
            currentYear?.id ?? "00000000-0000-0000-0000-000000000000"
          )
          .order("sort_order"),
        supabase
          .from("subjects")
          .select("*")
          .eq("is_active", true)
          .order("name"),
        // Retired teachers included on purpose: a period saved before they
        // left still names them, and dropping them from the list would render
        // the Select blank and let the next save wipe the assignment.
        // teacherOptions() keeps them out of the pickable set. (migration 116)
        supabase.from("teachers").select("*").order("full_name"),
      ]);

      setClasses((classesRes.data as Class[]) ?? []);
      setSubjects((subjectsRes.data as Subject[]) ?? []);
      setTeachers((teachersRes.data as Teacher[]) ?? []);
      setLoading(false);
    }

    fetchData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  const fetchPeriods = useCallback(async () => {
    if (!selectedClassId) {
      setPeriods([]);
      return;
    }

    setPeriodsLoading(true);
    const { data, error } = await supabase
      .from("timetable_periods")
      .select(
        "*, subjects(name), teachers:teacher_id(full_name, employee_id)"
      )
      .eq("class_id", selectedClassId)
      .order("day_of_week")
      .order("period_number")
      // Parallel groups share a period number (migration 119); order them so
      // the grid reads the same on every load.
      .order("group_no");

    if (error) {
      toast.error("Failed to fetch timetable");
      setPeriodsLoading(false);
      return;
    }

    const cells: PeriodCell[] = (data ?? []).map(
      (p: Record<string, unknown>) => ({
        ...(p as unknown as TimetablePeriod),
        subject_name:
          (p.subjects as { name: string } | null)?.name ?? undefined,
        teacher_name:
          (p.teachers as { full_name: string; employee_id: string } | null)?.full_name ?? undefined,
      })
    );

    setPeriods(cells);
    setPeriodsLoading(false);
  }, [supabase, selectedClassId]);

  useEffect(() => {
    fetchPeriods();
  }, [fetchPeriods]);

  // A cell holds one row per parallel group (migration 119) — Games split into
  // basketball/badminton/cricket, or an XI/XII period running IP alongside
  // P.Ed. Ordinary cells are a list of one and look exactly as they did.
  const getCellGroups = (day: number, period: number) =>
    periods
      .filter((p) => p.day_of_week === day && p.period_number === period)
      .sort((a, b) => (a.group_no ?? 0) - (b.group_no ?? 0));

  /** The cell's primary group — the row every pre-119 reader means. */
  const getCellData = (day: number, period: number) =>
    getCellGroups(day, period).find((p) => (p.group_no ?? 0) === 0) ??
    getCellGroups(day, period)[0];

  /** Load one group of the open cell into the form. */
  const loadGroup = (day: number, period: number, g: PeriodCell) => {
    const defaultPeriod = periodTimeDefaults(period);
    setEditingId(g.id);
    setFormData({
      day_of_week: String(day),
      period_number: String(period),
      subject_id: g.subject_id ?? "",
      teacher_id: g.teacher_id ?? "",
      start_time: g.start_time ?? defaultPeriod.start,
      end_time: g.end_time ?? defaultPeriod.end,
      room: g.room ?? "",
      group_no: g.group_no ?? 0,
      group_label: g.group_label ?? "",
      is_shared: g.is_shared ?? false,
    });
  };

  /** Start a blank group in the open cell, taking the next free group number. */
  const startNewGroup = (day: number, period: number) => {
    const groups = getCellGroups(day, period);
    const defaultPeriod = periodTimeDefaults(period);
    // Parallel groups share the cell's times by definition, so inherit them
    // from whatever is already there rather than making the admin retype.
    const template = groups[0];
    let nextNo = 0;
    const used = new Set(groups.map((g) => g.group_no ?? 0));
    while (used.has(nextNo)) nextNo++;
    setEditingId(null);
    setFormData({
      day_of_week: String(day),
      period_number: String(period),
      subject_id: template?.subject_id ?? "",
      teacher_id: "",
      start_time: template?.start_time ?? defaultPeriod.start,
      end_time: template?.end_time ?? defaultPeriod.end,
      room: template?.room ?? "",
      group_no: nextNo,
      group_label: "",
      // A second group in a cell is nearly always a parallel activity, and the
      // teacher of one is usually with other sections too. Pre-tick it rather
      // than let the first save fail on the clash constraint.
      is_shared: template?.is_shared ?? nextNo > 0,
    });
  };

  const openDialog = (day: number, period: number) => {
    const existing = getCellData(day, period);
    if (existing) loadGroup(day, period, existing);
    else startNewGroup(day, period);
    setDialogOpen(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!formData.subject_id) {
      toast.error("Please select a subject");
      return;
    }

    setSubmitting(true);

    const data = {
      class_id: selectedClassId,
      day_of_week: parseInt(formData.day_of_week),
      period_number: parseInt(formData.period_number),
      subject_id: formData.subject_id,
      teacher_id: formData.teacher_id || null,
      start_time: formData.start_time,
      end_time: formData.end_time,
      room: formData.room || null,
      group_no: formData.group_no,
      group_label: formData.group_label.trim() || null,
      is_shared: formData.is_shared,
    };

    const result = editingId
      ? await adminApi({
          action: "update",
          table: "timetable_periods",
          data,
          match: { column: "id", value: editingId },
        })
      : await adminApi({
          action: "insert",
          table: "timetable_periods",
          data,
        });

    if (!result.success) {
      toast.error(result.error || "Failed to save");
    } else {
      toast.success(
        editingId
          ? "Period updated"
          : formData.group_no > 0
            ? "Group added to the period"
            : "Period added"
      );
      setDialogOpen(false);
      fetchPeriods();
    }
    setSubmitting(false);
  };

  const handleDelete = async () => {
    if (!editingId) return;
    const isGroup = formData.group_no > 0;
    if (
      !confirm(
        isGroup
          ? "Remove this group from the period? The other groups stay."
          : "Remove this period?"
      )
    )
      return;

    const result = await adminApi({
      action: "delete",
      table: "timetable_periods",
      match: { column: "id", value: editingId },
    });

    if (!result.success) {
      toast.error("Failed to delete");
      return;
    }

    // Every reader that wants "the" row of a cell asks for group 0 — this
    // page's period-time header, and timetable_assignment_drift in SQL. So if
    // the main group has just gone and parallel ones remain, promote the
    // lowest of them rather than leaving the cell headless. (migration 119)
    if (!isGroup) {
      const survivors = getCellGroups(
        parseInt(formData.day_of_week),
        parseInt(formData.period_number)
      ).filter((g) => g.id !== editingId);
      if (survivors.length > 0) {
        const promote = survivors[0];
        const promoted = await adminApi({
          action: "update",
          table: "timetable_periods",
          match: { column: "id", value: promote.id },
          data: { group_no: 0 },
        });
        if (!promoted.success) {
          // The delete already happened, so say what is left rather than
          // pretending nothing changed.
          toast.error(
            promoted.error ||
              "Period removed, but the remaining group could not be made the main one."
          );
          setDialogOpen(false);
          fetchPeriods();
          return;
        }
      }
    }

    toast.success(isGroup ? "Group removed" : "Period removed");
    setDialogOpen(false);
    fetchPeriods();
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-navy-900 dark:text-white" />
      </div>
    );
  }

  // Rows to render: the default periods, every period_number already saved for
  // this class (so the grid scales past 8 and shows a zero period), plus any
  // the admin just added. Header times prefer a stored period's actual time.
  const allPeriodNums = Array.from(
    new Set<number>([
      ...DEFAULT_PERIODS.map((p) => p.num),
      ...periods.map((p) => p.period_number),
      ...extraPeriodNums,
    ])
  ).sort((a, b) => a - b);
  // The groups of the cell the dialog is open on. Derived rather than stored,
  // so it refreshes with `periods` after a save. (migration 119)
  const dialogGroups = dialogOpen
    ? getCellGroups(
        parseInt(formData.day_of_week),
        parseInt(formData.period_number)
      )
    : [];

  // Active teachers to pick from, plus whoever this period already names even
  // if they have since been retired. (migration 116)
  const teacherChoices = teacherOptions(
    teachers.filter((t) => t.is_active),
    formData.teacher_id,
    teachers
  );
  const periodRows = allPeriodNums.map((num) => {
    // Primary group only: parallel groups share the cell's times, and reading
    // an arbitrary one made the header depend on fetch order. (migration 119)
    const cell = periods.find(
      (p) => p.period_number === num && (p.group_no ?? 0) === 0
    );
    const def = periodTimeDefaults(num);
    return {
      num,
      start: cell?.start_time?.slice(0, 5) ?? def.start,
      end: cell?.end_time?.slice(0, 5) ?? def.end,
    };
  });

  const handlePrint = async () => {
    if (!selectedClassId) return;
    const res = await adminFetch(
      `/api/timetable/sheet?class_id=${selectedClassId}`
    );
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      toast.error(body.error ?? "Failed to generate the timetable");
      return;
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    window.open(url, "_blank", "noopener");
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  };

  // One cell of the timetable. Lifted out of the <td> so the week table and
  // the phone's day view draw the identical thing — a cell that renders
  // differently depending on which layout you are in is a bug waiting to be
  // reported as "the timetable is wrong on my phone".
  const renderCell = (dayValue: number, periodNum: number) => {
    const groups = getCellGroups(dayValue, periodNum);
    const cell = groups[0];
    const isLunch = cell?.is_break === true;
    return (
                        <button
                          onClick={() => openDialog(dayValue, periodNum)}
                          className={`w-full rounded-lg px-2 py-2 text-xs text-left transition-colors min-h-[56px] ${
                            isLunch
                              ? "bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 hover:bg-amber-100"
                              : cell
                                ? "bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 hover:bg-blue-100 dark:hover:bg-blue-900/30"
                                : "bg-gray-50 dark:bg-muted border border-dashed border-gray-200 dark:border-border hover:bg-gray-100 dark:hover:bg-muted hover:border-gray-300 dark:hover:border-gray-600"
                          }`}
                        >
                          {isLunch ? (
                            <div className="font-medium text-amber-800 dark:text-amber-300 flex items-center gap-1">
                              ☕ Lunch
                            </div>
                          ) : groups.length > 0 ? (
                            <div className="space-y-1">
                              {groups.map((g) => (
                                <div key={g.id}>
                                  <div className="font-medium text-navy-900 dark:text-white truncate">
                                    {g.group_label
                                      ? `${g.group_label} · ${g.subject_name}`
                                      : g.subject_name}
                                  </div>
                                  {g.teacher_name && (
                                    <div className="text-gray-500 dark:text-gray-400 truncate">
                                      {g.teacher_name}
                                    </div>
                                  )}
                                  {g.room && (
                                    <div className="text-gray-400 dark:text-gray-500 truncate">
                                      {g.room}
                                    </div>
                                  )}
                                </div>
                              ))}
                              {groups.some((g) => g.is_shared) && (
                                <div className="text-[10px] uppercase tracking-wide text-cyan-700 dark:text-cyan-400">  {/* color-ok: cyan is the Timetable module accent */}
                                  Shared
                                </div>
                              )}
                            </div>
                          ) : (
                            <div className="text-gray-300 dark:text-gray-600 text-center">
                              <Plus className="h-3 w-3 mx-auto" />
                            </div>
                          )}
                        </button>
    );
  };


  return (
    <div>
      <div className="flex items-center justify-between mb-6 flex-wrap gap-2">
        <h1 className="font-heading text-2xl font-bold text-navy-900 dark:text-white">
          Timetable
        </h1>
        <div className="flex gap-2 flex-wrap items-center">
          <AcademicSessionPicker state={session} />
          {/* Templates, Auto Generate and Import are each already a sidebar
              entry under Timetable, so as three more buttons here they were
              a second doorway to the same three rooms — and on a phone they
              wrapped into two rows of chrome above a timetable that had not
              been drawn yet. One menu keeps them reachable from the screen
              they are used from without spending the width. */}
          <DropdownMenu>
            <DropdownMenuTrigger
              render={<Button variant="outline" className="gap-1.5" />}
            >
              Set up
              <ChevronDown className="h-4 w-4" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem render={<Link href="/timetable/templates" />}>
                Period templates
              </DropdownMenuItem>
              <DropdownMenuItem render={<Link href="/timetable/generate" />}>
                Auto generate
              </DropdownMenuItem>
              <DropdownMenuItem render={<Link href="/timetable/import" />}>
                Import from Excel
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button
            variant="outline"
            onClick={handlePrint}
            disabled={!selectedClassId}
          >
            <Printer className="h-4 w-4 mr-1" />
            Print
          </Button>
        </div>
      </div>

      {/* Class selector */}
      <div className="mb-6 w-full sm:w-72">
        <Select
          value={selectedClassId}
          items={classes.map((c) => ({ value: c.id, label: formatClassName(c) }))}
          onValueChange={(val) => val && setSelectedClassId(val)}
        >
          <SelectTrigger>
            <SelectValue placeholder="Select a class..." />
          </SelectTrigger>
          <SelectContent>
            {classes.map((c) => (
              <SelectItem key={c.id} value={c.id} label={formatClassName(c)}>
                {formatClassName(c)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {!selectedClassId ? (
        <div className="erp-table-container p-4 sm:p-6">
          <div className="mx-auto max-w-md text-center py-12">
            <div className="h-14 w-14 rounded-2xl bg-navy-900/5 dark:bg-white/5 flex items-center justify-center mx-auto mb-4">
              <Clock className="h-7 w-7 text-navy-900/70 dark:text-white/70" />
            </div>
            <h3 className="text-base font-semibold text-navy-900 dark:text-white mb-1">
              Pick a class to edit its weekly schedule
            </h3>
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
              Timetables repeat every Monday through Saturday for the entire
              academic year. Add or update a period once and it applies to every
              week.
            </p>
            {academicYear && (
              <div className="inline-flex items-center gap-2 rounded-full bg-gray-100 dark:bg-muted px-3 py-1.5 text-xs text-gray-600 dark:text-gray-300">
                <CalendarRange className="h-3.5 w-3.5" />
                Academic year {academicYear.name} ·{" "}
                {formatShortDate(academicYear.start_date)}–
                {formatShortDate(academicYear.end_date)}
              </div>
            )}
          </div>
        </div>
      ) : periodsLoading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
        </div>
      ) : (
        <>
          {academicYear && (
            <div className="mb-3 flex items-center gap-2 rounded-lg border border-blue-100 dark:border-blue-900/40 bg-blue-50/60 dark:bg-blue-950/20 px-3 py-2 text-xs text-blue-800 dark:text-blue-300">
              <Info className="h-3.5 w-3.5 shrink-0" />
              <span>
                This schedule applies to every week of{" "}
                <strong className="font-semibold">{academicYear.name}</strong>{" "}
                ({formatShortDate(academicYear.start_date)}–
                {formatShortDate(academicYear.end_date)}) until you change it.
              </span>
            </div>
          )}
          <div className="mb-3 flex flex-wrap gap-2">
            {!allPeriodNums.includes(0) && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setExtraPeriodNums((prev) => [...prev, 0])}
              >
                <Plus className="h-4 w-4 mr-1" /> Add zero period
              </Button>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                setExtraPeriodNums((prev) => [
                  ...prev,
                  Math.max(...allPeriodNums) + 1,
                ])
              }
            >
              <Plus className="h-4 w-4 mr-1" /> Add period
            </Button>
          </div>
          {/* Phone: one day at a time.
              The week is Period x six days. In a horizontal scroller that is
              a grid you drag sideways through with no column headers in
              view, so you lose track of which day you are editing. Pick the
              day, read the day. renderCell is shared with the table below,
              so the two cannot disagree. */}
          <div className="sm:hidden">
            <div className="mb-3 grid grid-cols-3 gap-1 rounded-xl bg-gray-100 p-1 dark:bg-muted"> {/* mobile-layout-ok: six three-letter day chips */}
              {DAYS.map((d) => (
                <button
                  key={d.value}
                  onClick={() => setMobileDay(d.value)}
                  aria-current={mobileDay === d.value ? "true" : undefined}
                  className={`rounded-lg px-2 py-2 text-sm font-medium transition-colors ${
                    mobileDay === d.value
                      ? "bg-white dark:bg-card text-navy-900 dark:text-white shadow-sm"
                      : "text-gray-500 dark:text-gray-400"
                  }`}
                >
                  {d.label.slice(0, 3)}
                </button>
              ))}
            </div>
            <ul className="space-y-2">
              {periodRows.map((dp) => (
                <li key={dp.num} className="flex items-start gap-3">
                  <div className="w-16 shrink-0 pt-2 text-gray-600 dark:text-gray-300">
                    <div className="text-sm font-medium">
                      {dp.num === 0 ? "Zero" : `P${dp.num}`}
                    </div>
                    <div className="text-[11px] text-gray-400 dark:text-gray-500">
                      {dp.start}-{dp.end}
                    </div>
                  </div>
                  <div className="min-w-0 flex-1">
                    {renderCell(mobileDay, dp.num)}
                  </div>
                </li>
              ))}
            </ul>
          </div>

          <div className="erp-table-container hidden overflow-x-auto overscroll-x-contain sm:block">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 dark:bg-muted">
                <th className="px-3 py-3 text-left font-medium text-gray-500 dark:text-gray-400 border-b dark:border-border">
                  Period
                </th>
                {DAYS.map((d) => (
                  <th
                    key={d.value}
                    className="px-3 py-3 text-center font-medium text-gray-500 dark:text-gray-400 border-b dark:border-border"
                  >
                    {d.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {periodRows.map((dp) => (
                <tr key={dp.num} className="border-b border-gray-100 dark:border-border">
                  <td className="px-3 py-2 text-gray-600 dark:text-gray-300">
                    <div className="font-medium">
                      {dp.num === 0 ? "Zero Period" : `P${dp.num}`}
                    </div>
                    <div className="text-xs text-gray-400 dark:text-gray-500">
                      {dp.start}-{dp.end}
                    </div>
                  </td>
                  {DAYS.map((d) => (
                      <td key={d.value} className="px-1 py-1 align-top">
                        {renderCell(d.value, dp.num)}
                      </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </>
      )}

      {/* Period Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-cyan-500/10">  {/* color-ok: cyan is the Timetable module accent */}
                <Clock className="h-5 w-5 text-cyan-600 dark:text-cyan-400" />
              </div>
              <div>
                <DialogTitle>{editingId ? "Edit Period" : "Add Period"}</DialogTitle>
                <p className="text-xs text-gray-500 mt-0.5">
                  {editingId
                    ? "Update period details"
                    : formData.group_no > 0
                      ? "Another group running in the same period"
                      : "Add a new period to the timetable"}
                </p>
              </div>
            </div>
          </DialogHeader>
          {/* Groups already in this cell. A period with one group — almost all
              of them — shows a single chip and reads as it always did.
              (migration 119) */}
          {dialogGroups.length > 0 && (
            <div className="rounded-lg border border-gray-200 dark:border-border p-2">
              <div className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">
                {dialogGroups.length === 1
                  ? "This period"
                  : `${dialogGroups.length} groups in this period`}
              </div>
              <div className="flex flex-wrap gap-1.5">
                {dialogGroups.map((g) => (
                  <button
                    key={g.id}
                    type="button"
                    onClick={() =>
                      loadGroup(
                        parseInt(formData.day_of_week),
                        parseInt(formData.period_number),
                        g
                      )
                    }
                    className={`rounded-md border px-2 py-1 text-xs transition-colors ${
                      editingId === g.id
                        ? "border-cyan-400 bg-cyan-50 text-cyan-800 dark:border-cyan-700 dark:bg-cyan-950/30 dark:text-cyan-300" // color-ok: cyan is the Timetable module accent, matching its hub tile
                        : "border-gray-200 text-gray-600 hover:bg-gray-50 dark:border-border dark:text-gray-300 dark:hover:bg-muted"
                    }`}
                  >
                    {g.group_label || g.subject_name || `Group ${g.group_no ?? 0}`}
                    {g.teacher_name ? (
                      <span className="ml-1 opacity-60">· {g.teacher_name}</span>
                    ) : null}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() =>
                    startNewGroup(
                      parseInt(formData.day_of_week),
                      parseInt(formData.period_number)
                    )
                  }
                  className="rounded-md border border-dashed border-gray-300 px-2 py-1 text-xs text-gray-500 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-400 dark:hover:bg-muted"
                >
                  <Plus className="mr-1 inline h-3 w-3" />
                  Add group
                </button>
              </div>
              <p className="mt-1.5 text-[11px] text-gray-400 dark:text-gray-500">
                Several teachers in one period — games split by sport, or two
                optional subjects side by side.
              </p>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-3">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <Label className="text-xs font-medium">Day</Label>
                <NativeSelect
                  value={formData.day_of_week}
                  disabled
                  className="w-full"
                >
                  {DAYS.map((d) => (
                    <option key={d.value} value={d.value}>
                      {d.label}
                    </option>
                  ))}
                </NativeSelect>
              </div>
              <div className="space-y-1">
                <Label className="text-xs font-medium">Period</Label>
                <Input
                  value={
                    formData.period_number === "0"
                      ? "Zero Period"
                      : `Period ${formData.period_number}`
                  }
                  disabled
                  className="bg-gray-50 dark:bg-muted h-9"
                />
              </div>
            </div>
            <div className="space-y-1">
              <Label className="text-xs font-medium">Subject</Label>
              <Select
                value={formData.subject_id}
                items={subjects.map((s) => ({ value: s.id, label: s.name + (s.code ? ` (${s.code})` : "") }))}
                onValueChange={(val) =>
                  val && setFormData({ ...formData, subject_id: val })
                }
              >
                <SelectTrigger className="w-full h-9">
                  <SelectValue placeholder="Select subject" />
                </SelectTrigger>
                <SelectContent>
                  {subjects.map((s) => (
                    <SelectItem key={s.id} value={s.id} label={s.name + (s.code ? ` (${s.code})` : "")}>
                      {s.name}
                      {s.code ? ` (${s.code})` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs font-medium">Teacher (optional)</Label>
              <Select
                value={formData.teacher_id}
                items={[{ value: "none", label: "None" }, ...teacherChoices]}
                onValueChange={(val) =>
                  setFormData({
                    ...formData,
                    teacher_id: !val || val === "none" ? "" : val,
                  })
                }
              >
                <SelectTrigger className="w-full h-9">
                  <SelectValue placeholder="Select teacher" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">None</SelectItem>
                  {teacherChoices.map((t) => (
                    <SelectItem key={t.value} value={t.value} label={t.label}>
                      {t.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <Label className="text-xs font-medium">Start Time</Label>
                <Input
                  className="h-9"
                  type="time"
                  value={formData.start_time}
                  onChange={(e) =>
                    setFormData({ ...formData, start_time: e.target.value })
                  }
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs font-medium">End Time</Label>
                <Input
                  className="h-9"
                  type="time"
                  value={formData.end_time}
                  onChange={(e) =>
                    setFormData({ ...formData, end_time: e.target.value })
                  }
                />
              </div>
            </div>
            <div className="space-y-1">
              <Label className="text-xs font-medium">Room (optional)</Label>
              <Input
                className="h-9"
                placeholder="e.g. Room 101"
                value={formData.room}
                onChange={(e) =>
                  setFormData({ ...formData, room: e.target.value })
                }
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs font-medium">
                Group name (optional)
              </Label>
              <Input
                className="h-9"
                placeholder="e.g. Basketball"
                value={formData.group_label}
                onChange={(e) =>
                  setFormData({ ...formData, group_label: e.target.value })
                }
              />
              <p className="text-[11px] text-gray-400">
                Only needed when the subject does not say it — three Games
                groups called Basketball, Badminton and Cricket.
              </p>
            </div>
            <label className="flex cursor-pointer items-start gap-2 rounded-lg bg-gray-50 p-2.5 dark:bg-muted">
              <input
                type="checkbox"
                checked={formData.is_shared}
                onChange={(e) =>
                  setFormData({ ...formData, is_shared: e.target.checked })
                }
                className="mt-0.5 rounded border-gray-300 dark:border-gray-600 text-navy-900 dark:text-white focus:ring-navy-900"
              />
              <span className="text-xs text-gray-700 dark:text-gray-300">
                <span className="font-medium">Shared activity</span> — this
                teacher is with other classes at the same time.
                <span className="block text-gray-500 dark:text-gray-400">
                  Normally a teacher cannot be in two places at once and saving
                  would be refused. Tick this for a games period where one coach
                  takes several sections together.
                </span>
              </span>
            </label>
            <DialogFooter>
              {editingId && (
                <Button
                  type="button"
                  variant="outline"
                  onClick={handleDelete}
                  className="text-red-500 hover:text-red-700 mr-auto"
                >
                  <Trash2 className="h-4 w-4 mr-2" />
                  Remove
                </Button>
              )}
              <Button
                type="button"
                variant="outline"
                onClick={() => setDialogOpen(false)}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={submitting}
                className="bg-navy-900 hover:bg-navy-800 text-white dark:bg-gold-500 dark:hover:bg-gold-400 dark:text-navy-900"
              >
                {submitting && (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                )}
                {editingId ? "Update" : "Add"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
