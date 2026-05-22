"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { createClient } from "@nkps/shared/lib/supabase/client";
import { useUrlState } from "@nkps/shared/lib/hooks/use-url-state";
import { Button } from "@nkps/shared/components/ui/button";
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
import { Plus, Trash2, Loader2, Clock, CalendarRange, Info } from "lucide-react";
import { adminApi } from "@nkps/shared/lib/admin-api";
import { formatClassName, formatShortDate } from "@nkps/shared/lib/utils";
import type { Class, Subject, Teacher, TimetablePeriod } from "@nkps/shared/types";

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

  const [dialogOpen, setDialogOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formData, setFormData] = useState({
    day_of_week: "1",
    period_number: "1",
    subject_id: "",
    teacher_id: "",
    start_time: "08:00",
    end_time: "08:45",
    room: "",
  });

  useEffect(() => {
    async function fetchData() {
      const { data: currentYear } = await supabase
        .from("academic_years")
        .select("id, name, start_date, end_date")
        .eq("is_current", true)
        .single();

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
        supabase
          .from("teachers")
          .select("*")
          .eq("is_active", true)
          .order("full_name"),
      ]);

      setClasses((classesRes.data as Class[]) ?? []);
      setSubjects((subjectsRes.data as Subject[]) ?? []);
      setTeachers((teachersRes.data as Teacher[]) ?? []);
      setLoading(false);
    }

    fetchData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
      .order("period_number");

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

  const getCellData = (day: number, period: number) =>
    periods.find((p) => p.day_of_week === day && p.period_number === period);

  const openDialog = (day: number, period: number) => {
    const existing = getCellData(day, period);
    const defaultPeriod = DEFAULT_PERIODS.find((p) => p.num === period);

    if (existing) {
      setEditingId(existing.id);
      setFormData({
        day_of_week: String(day),
        period_number: String(period),
        subject_id: existing.subject_id ?? "",
        teacher_id: existing.teacher_id ?? "",
        start_time: existing.start_time ?? defaultPeriod?.start ?? "08:00",
        end_time: existing.end_time ?? defaultPeriod?.end ?? "08:45",
        room: existing.room ?? "",
      });
    } else {
      setEditingId(null);
      setFormData({
        day_of_week: String(day),
        period_number: String(period),
        subject_id: "",
        teacher_id: "",
        start_time: defaultPeriod?.start ?? "08:00",
        end_time: defaultPeriod?.end ?? "08:45",
        room: "",
      });
    }
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
      toast.success(editingId ? "Period updated" : "Period added");
      setDialogOpen(false);
      fetchPeriods();
    }
    setSubmitting(false);
  };

  const handleDelete = async () => {
    if (!editingId) return;
    if (!confirm("Remove this period?")) return;

    const result = await adminApi({
      action: "delete",
      table: "timetable_periods",
      match: { column: "id", value: editingId },
    });

    if (!result.success) {
      toast.error("Failed to delete");
      return;
    }

    toast.success("Period removed");
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

  return (
    <div>
      <div className="flex items-center justify-between mb-6 flex-wrap gap-2">
        <h1 className="font-heading text-2xl font-bold text-navy-900 dark:text-white">
          Timetable
        </h1>
        <div className="flex gap-2 flex-wrap">
          <Link
            href="/timetable/templates"
            className="inline-flex items-center gap-1.5 rounded-md border border-gray-200 dark:border-border px-3 py-1.5 text-sm hover:bg-gray-50 dark:hover:bg-muted"
          >
            Templates
          </Link>
          <Link
            href="/timetable/generate"
            className="inline-flex items-center gap-1.5 rounded-md border border-gray-200 dark:border-border px-3 py-1.5 text-sm hover:bg-gray-50 dark:hover:bg-muted"
          >
            Auto Generate
          </Link>
          <Link
            href="/timetable/import"
            className="inline-flex items-center gap-1.5 rounded-md border border-gray-200 dark:border-border px-3 py-1.5 text-sm hover:bg-gray-50 dark:hover:bg-muted"
          >
            Import (Excel)
          </Link>
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
        <div className="erp-table-container p-6">
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
          <div className="erp-table-container overflow-x-auto">
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
              {DEFAULT_PERIODS.map((dp) => (
                <tr key={dp.num} className="border-b border-gray-100 dark:border-border">
                  <td className="px-3 py-2 text-gray-600 dark:text-gray-300">
                    <div className="font-medium">P{dp.num}</div>
                    <div className="text-xs text-gray-400 dark:text-gray-500">
                      {dp.start}-{dp.end}
                    </div>
                  </td>
                  {DAYS.map((d) => {
                    const cell = getCellData(d.value, dp.num);
                    const isLunch = cell?.is_break === true;
                    return (
                      <td key={d.value} className="px-1 py-1">
                        <button
                          onClick={() => openDialog(d.value, dp.num)}
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
                          ) : cell ? (
                            <>
                              <div className="font-medium text-navy-900 dark:text-white truncate">
                                {cell.subject_name}
                              </div>
                              {cell.teacher_name && (
                                <div className="text-gray-500 dark:text-gray-400 truncate">
                                  {cell.teacher_name}
                                </div>
                              )}
                              {cell.room && (
                                <div className="text-gray-400 dark:text-gray-500 truncate">
                                  {cell.room}
                                </div>
                              )}
                            </>
                          ) : (
                            <div className="text-gray-300 dark:text-gray-600 text-center">
                              <Plus className="h-3 w-3 mx-auto" />
                            </div>
                          )}
                        </button>
                      </td>
                    );
                  })}
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
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-cyan-500/10">
                <Clock className="h-5 w-5 text-cyan-600" />
              </div>
              <div>
                <DialogTitle>{editingId ? "Edit Period" : "Add Period"}</DialogTitle>
                <p className="text-xs text-gray-500 mt-0.5">{editingId ? "Update period details" : "Add a new period to the timetable"}</p>
              </div>
            </div>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs font-medium">Day</Label>
                <select
                  value={formData.day_of_week}
                  disabled
                  className="w-full rounded-md border border-gray-300 dark:border-gray-600 px-3 py-2 text-sm bg-gray-50 dark:bg-muted dark:text-gray-300 h-9"
                >
                  {DAYS.map((d) => (
                    <option key={d.value} value={d.value}>
                      {d.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs font-medium">Period</Label>
                <Input
                  value={`Period ${formData.period_number}`}
                  disabled
                  className="bg-gray-50 h-9"
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
                items={[
                  { value: "none", label: "None" },
                  ...teachers.map((t) => ({ value: t.id, label: `${t.full_name} (${t.employee_id})` })),
                ]}
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
                  {teachers.map((t) => (
                    <SelectItem key={t.id} value={t.id} label={`${t.full_name} (${t.employee_id})`}>
                      {t.full_name} ({t.employee_id})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
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
                className="bg-navy-900 hover:bg-navy-800 text-white"
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
