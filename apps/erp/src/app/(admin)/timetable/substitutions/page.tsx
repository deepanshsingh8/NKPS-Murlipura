"use client";

import { useEffect, useState, useCallback } from "react";
import { createClient } from "@nkps/shared/lib/supabase/client";
import { adminFetch, adminDelete } from "@nkps/shared/lib/admin-api";
import { Button } from "@nkps/shared/components/ui/button";
import { Input } from "@nkps/shared/components/ui/input";
import { Label } from "@nkps/shared/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@nkps/shared/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@nkps/shared/components/ui/dialog";
import {
  Loader2,
  Plus,
  Printer,
  Trash2,
  UserCheck,
  CalendarX2,
  Inbox,
  Clock,
} from "lucide-react";
import { toast } from "sonner";
import type { Teacher } from "@nkps/shared/types";
import { SubstitutePickerDialog } from "@/components/timetable/SubstitutePickerDialog";

const HALF_DAY_OPTIONS = [
  { value: "full", label: "Full day" },
  { value: "first_half", label: "First half (morning)" },
  { value: "second_half", label: "Second half (afternoon)" },
] as const;

interface AbsenceRow {
  id: string;
  teacher_id: string;
  absence_date: string;
  half_day: "full" | "first_half" | "second_half";
  reason: string | null;
  teachers:
    | { id: string; full_name: string; employee_id: string | null }
    | { id: string; full_name: string; employee_id: string | null }[]
    | null;
}

interface SuggestPeriodPayload {
  period: {
    id: string;
    period_number: number;
    start_time: string;
    end_time: string;
    room: string | null;
    classes: { name: string; section: string | null } | { name: string; section: string | null }[] | null;
    subjects: { name: string } | { name: string }[] | null;
  };
  current_substitution: {
    id: string;
    substitute_teacher_id: string | null;
    teachers:
      | { id: string; full_name: string }
      | { id: string; full_name: string }[]
      | null;
  } | null;
  candidates: unknown[];
  candidate_count_total: number;
}

function pickOne<T>(rel: T | T[] | null | undefined): T | null {
  if (!rel) return null;
  return Array.isArray(rel) ? (rel[0] ?? null) : rel;
}

function todayIso(): string {
  const d = new Date();
  d.setHours(12, 0, 0, 0);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function formatTime(t: string): string {
  return t.length >= 5 ? t.slice(0, 5) : t;
}

function halfDayLabel(h: string): string {
  return HALF_DAY_OPTIONS.find((o) => o.value === h)?.label ?? h;
}

export default function AdminSubstitutionsPage() {
  const supabase = createClient();
  const [date, setDate] = useState(todayIso());

  const [teachers, setTeachers] = useState<Teacher[]>([]);
  const [absences, setAbsences] = useState<AbsenceRow[]>([]);
  const [loadingAbsences, setLoadingAbsences] = useState(false);
  const [selectedAbsenceId, setSelectedAbsenceId] = useState<string | null>(null);

  const [periodsForAbsence, setPeriodsForAbsence] = useState<SuggestPeriodPayload[]>([]);
  const [periodsLoading, setPeriodsLoading] = useState(false);

  const [picker, setPicker] = useState<{
    open: boolean;
    period: SuggestPeriodPayload["period"] | null;
    currentSubstituteId: string | null;
  }>({ open: false, period: null, currentSubstituteId: null });

  const [markDialogOpen, setMarkDialogOpen] = useState(false);

  // Load teachers once.
  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("teachers")
        .select("*")
        .eq("is_active", true)
        .order("full_name");
      setTeachers((data as Teacher[]) ?? []);
    })();
  }, [supabase]);

  const fetchAbsences = useCallback(async () => {
    setLoadingAbsences(true);
    const res = await adminFetch(`/api/teacher-absences?date=${date}`);
    if (!res.ok) {
      toast.error("Failed to load absences");
      setAbsences([]);
    } else {
      const body = await res.json();
      setAbsences((body.data as AbsenceRow[]) ?? []);
    }
    setLoadingAbsences(false);
  }, [date]);

  useEffect(() => {
    fetchAbsences();
  }, [fetchAbsences]);

  // When date or absences change, clear the right-pane selection if it's gone.
  useEffect(() => {
    if (selectedAbsenceId && !absences.find((a) => a.id === selectedAbsenceId)) {
      setSelectedAbsenceId(null);
      setPeriodsForAbsence([]);
    }
  }, [absences, selectedAbsenceId]);

  const fetchPeriodsFor = useCallback(async (absenceId: string) => {
    setPeriodsLoading(true);
    const res = await adminFetch(
      `/api/substitutions/suggest?absence_id=${absenceId}`
    );
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      toast.error(body.error ?? "Failed to load periods");
      setPeriodsForAbsence([]);
    } else {
      const body = await res.json();
      setPeriodsForAbsence(
        (body.data?.periods as SuggestPeriodPayload[]) ?? []
      );
    }
    setPeriodsLoading(false);
  }, []);

  useEffect(() => {
    if (selectedAbsenceId) fetchPeriodsFor(selectedAbsenceId);
    else setPeriodsForAbsence([]);
  }, [selectedAbsenceId, fetchPeriodsFor]);

  const handleDeleteAbsence = async (id: string) => {
    if (!confirm("Remove this absence? Any assigned substitutes for it will also be removed.")) {
      return;
    }
    const res = await adminDelete(`/api/teacher-absences/${id}`, {});
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      toast.error(body.error ?? "Failed to delete");
      return;
    }
    toast.success("Absence removed");
    fetchAbsences();
  };

  const handleUnassign = async (substitutionId: string) => {
    const res = await adminDelete(`/api/substitutions/${substitutionId}`, {});
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      toast.error(body.error ?? "Failed to unassign");
      return;
    }
    toast.success("Substitute removed");
    if (selectedAbsenceId) fetchPeriodsFor(selectedAbsenceId);
  };

  const handlePrint = async () => {
    const res = await adminFetch(`/api/substitutions/sheet?date=${date}`);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      toast.error(body.error ?? "Failed to generate sheet");
      return;
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    window.open(url, "_blank", "noopener");
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <h1 className="font-heading text-2xl font-bold text-navy-900 dark:text-white">
          Substitutions
        </h1>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-2">
            <Label htmlFor="sub-date" className="text-xs text-gray-500 dark:text-gray-400">
              Date
            </Label>
            <Input
              id="sub-date"
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="w-40"
            />
          </div>
          <Button variant="outline" onClick={handlePrint} disabled={absences.length === 0}>
            <Printer className="h-4 w-4 mr-1" />
            Print sheet
          </Button>
          <Button onClick={() => setMarkDialogOpen(true)}>
            <Plus className="h-4 w-4 mr-1" />
            Mark teacher absent
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[18rem_1fr] gap-4">
        {/* Left: absent list */}
        <div className="erp-table-container p-3">
          <div className="text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400 px-1 pb-2">
            Absent on {date}
          </div>
          {loadingAbsences ? (
            <div className="flex justify-center py-6">
              <Loader2 className="h-5 w-5 animate-spin text-gray-400" />
            </div>
          ) : absences.length === 0 ? (
            <div className="text-center py-8 text-sm text-gray-500 dark:text-gray-400">
              <Inbox className="h-6 w-6 mx-auto mb-2 text-gray-300 dark:text-gray-600" />
              No absences recorded for this date.
            </div>
          ) : (
            <ul className="space-y-1">
              {absences.map((a) => {
                const t = pickOne(a.teachers);
                const selected = a.id === selectedAbsenceId;
                return (
                  <li key={a.id}>
                    <button
                      onClick={() => setSelectedAbsenceId(a.id)}
                      className={`w-full text-left rounded-lg px-3 py-2 text-sm transition-colors ${
                        selected
                          ? "bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800"
                          : "hover:bg-gray-50 dark:hover:bg-muted border border-transparent"
                      }`}
                    >
                      <div className="font-medium text-navy-900 dark:text-white truncate">
                        {t?.full_name ?? "Unknown"}
                      </div>
                      <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 flex items-center gap-2">
                        <span>{halfDayLabel(a.half_day)}</span>
                        {a.reason && (
                          <span className="truncate" title={a.reason}>
                            · {a.reason}
                          </span>
                        )}
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {/* Right: per-period substitution view */}
        <div className="erp-table-container p-4">
          {!selectedAbsenceId ? (
            <div className="text-center py-12 text-sm text-gray-500 dark:text-gray-400">
              <CalendarX2 className="h-7 w-7 mx-auto mb-3 text-gray-300 dark:text-gray-600" />
              Select an absent teacher on the left to see their affected
              periods and assign substitutes.
            </div>
          ) : periodsLoading ? (
            <div className="flex justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
            </div>
          ) : periodsForAbsence.length === 0 ? (
            <div className="text-center py-10 text-sm text-gray-500 dark:text-gray-400">
              This teacher has no scheduled periods for the selected portion of
              the day.
              <Button
                variant="ghost"
                size="sm"
                className="ml-2"
                onClick={() => handleDeleteAbsence(selectedAbsenceId)}
              >
                Remove absence
              </Button>
            </div>
          ) : (
            <ul className="space-y-2">
              {periodsForAbsence.map((row) => {
                const cls = pickOne(row.period.classes);
                const subj = pickOne(row.period.subjects);
                const className = cls
                  ? `${cls.name}${cls.section ? "-" + cls.section : ""}`
                  : "?";
                const sub = row.current_substitution;
                const subTeacher = sub ? pickOne(sub.teachers) : null;
                return (
                  <li
                    key={row.period.id}
                    className="rounded-lg border border-gray-200 dark:border-border bg-white dark:bg-card p-3 flex items-start justify-between gap-3"
                  >
                    <div className="min-w-0">
                      <div className="font-medium text-navy-900 dark:text-white">
                        P{row.period.period_number} · {className} ·{" "}
                        {subj?.name ?? "—"}
                      </div>
                      <div className="text-xs text-gray-500 dark:text-gray-400 mt-1 flex items-center gap-1">
                        <Clock className="h-3 w-3" />
                        {formatTime(row.period.start_time)}–
                        {formatTime(row.period.end_time)}
                        {row.period.room ? ` · ${row.period.room}` : ""}
                      </div>
                      {sub && subTeacher ? (
                        <div className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-emerald-700 dark:text-emerald-300">
                          <UserCheck className="h-3.5 w-3.5" />
                          Substitute: {subTeacher.full_name}
                        </div>
                      ) : (
                        <div className="mt-2 text-xs text-amber-700 dark:text-amber-300">
                          No substitute assigned
                        </div>
                      )}
                    </div>
                    <div className="flex flex-col items-end gap-1 shrink-0">
                      <Button
                        size="sm"
                        variant={sub ? "outline" : "default"}
                        onClick={() =>
                          setPicker({
                            open: true,
                            period: row.period,
                            currentSubstituteId: sub?.substitute_teacher_id ?? null,
                          })
                        }
                      >
                        {sub ? "Change" : "Find substitute"}
                      </Button>
                      {sub && (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="text-destructive hover:text-destructive"
                          onClick={() => handleUnassign(sub.id)}
                        >
                          <Trash2 className="h-3 w-3 mr-1" />
                          Unassign
                        </Button>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>

      {picker.open && picker.period && selectedAbsenceId && (
        <SubstitutePickerDialog
          open={picker.open}
          onOpenChange={(open) =>
            setPicker((s) => ({ ...s, open }))
          }
          absenceId={selectedAbsenceId}
          period={picker.period}
          currentSubstituteId={picker.currentSubstituteId}
          onAssigned={() => {
            if (selectedAbsenceId) fetchPeriodsFor(selectedAbsenceId);
          }}
        />
      )}

      <MarkAnyTeacherAbsentDialog
        open={markDialogOpen}
        onOpenChange={setMarkDialogOpen}
        teachers={teachers}
        defaultDate={date}
        onSaved={() => {
          setMarkDialogOpen(false);
          fetchAbsences();
        }}
      />
    </div>
  );
}

// Page-local dialog: pick teacher + date + half_day + reason. Distinct from
// the per-teacher MarkAbsentDialog because we don't have a teacher pre-
// selected on this page.
interface MarkAnyProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  teachers: Teacher[];
  defaultDate: string;
  onSaved: () => void;
}

function MarkAnyTeacherAbsentDialog({
  open,
  onOpenChange,
  teachers,
  defaultDate,
  onSaved,
}: MarkAnyProps) {
  const [teacherId, setTeacherId] = useState("");
  const [date, setDate] = useState(defaultDate);
  const [halfDay, setHalfDay] = useState<"full" | "first_half" | "second_half">("full");
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      setTeacherId("");
      setDate(defaultDate);
      setHalfDay("full");
      setReason("");
    }
  }, [open, defaultDate]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!teacherId) {
      toast.error("Pick a teacher");
      return;
    }
    if (!date) {
      toast.error("Pick a date");
      return;
    }
    setSubmitting(true);
    const res = await adminFetch("/api/teacher-absences", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        teacher_id: teacherId,
        absence_date: date,
        half_day: halfDay,
        reason: reason.trim() || null,
      }),
    });
    setSubmitting(false);
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      toast.error(body.error ?? "Failed to mark absent");
      return;
    }
    toast.success("Marked absent");
    onSaved();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Mark teacher absent</DialogTitle>
          <DialogDescription>
            Records an absence for the selected date and unlocks substitute
            assignment.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="mark-teacher">Teacher</Label>
            <Select
              value={teacherId}
              items={teachers.map((t) => ({
                value: t.id,
                label: `${t.full_name}${t.employee_id ? ` (${t.employee_id})` : ""}`,
              }))}
              onValueChange={(v) => v && setTeacherId(v)}
            >
              <SelectTrigger id="mark-teacher">
                <SelectValue placeholder="Select a teacher..." />
              </SelectTrigger>
              <SelectContent>
                {teachers.map((t) => (
                  <SelectItem
                    key={t.id}
                    value={t.id}
                    label={`${t.full_name}${t.employee_id ? ` (${t.employee_id})` : ""}`}
                  >
                    {t.full_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="mark-date">Date</Label>
            <Input
              id="mark-date"
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              required
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="mark-half-day">Coverage</Label>
            <Select
              value={halfDay}
              items={HALF_DAY_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
              onValueChange={(v) =>
                v && setHalfDay(v as "full" | "first_half" | "second_half")
              }
            >
              <SelectTrigger id="mark-half-day">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {HALF_DAY_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value} label={o.label}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="mark-reason">Reason (optional)</Label>
            <textarea
              id="mark-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
              maxLength={500}
              placeholder="Medical, school duty, personal leave…"
              className="w-full rounded-lg border border-input bg-transparent px-2.5 py-1.5 text-sm transition-colors outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30"
            />
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={submitting}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Mark absent
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
