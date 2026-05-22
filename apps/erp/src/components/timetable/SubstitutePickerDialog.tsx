"use client";

import { useEffect, useState } from "react";
import { adminFetch } from "@nkps/shared/lib/admin-api";
import { Button } from "@nkps/shared/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@nkps/shared/components/ui/dialog";
import { Loader2, UserCheck, AlertCircle } from "lucide-react";
import { toast } from "sonner";

interface PeriodInfo {
  id: string;
  start_time: string;
  end_time: string;
  room: string | null;
  classes:
    | { name: string; section: string | null }
    | { name: string; section: string | null }[]
    | null;
  subjects:
    | { name: string }
    | { name: string }[]
    | null;
}

interface Candidate {
  teacher: {
    id: string;
    full_name: string;
    employee_id: string | null;
    specialization: string | null;
  };
  score: number;
  reasons: string[];
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  absenceId: string;
  period: PeriodInfo;
  // Currently-assigned substitute (if any) so the dialog can show "Already
  // assigned to: X" + an "Unassign" button.
  currentSubstituteId?: string | null;
  onAssigned: () => void;
}

function pickOne<T>(rel: T | T[] | null | undefined): T | null {
  if (!rel) return null;
  return Array.isArray(rel) ? (rel[0] ?? null) : rel;
}

function formatTime(t: string): string {
  return t.length >= 5 ? t.slice(0, 5) : t;
}

export function SubstitutePickerDialog({
  open,
  onOpenChange,
  absenceId,
  period,
  currentSubstituteId,
  onAssigned,
}: Props) {
  const [loading, setLoading] = useState(false);
  const [candidates, setCandidates] = useState<Candidate[] | null>(null);
  const [totalCount, setTotalCount] = useState(0);
  const [submittingId, setSubmittingId] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    async function load() {
      setLoading(true);
      const res = await adminFetch(
        `/api/substitutions/suggest?absence_id=${absenceId}`
      );
      if (cancelled) return;
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(body.error ?? "Failed to load suggestions");
        setCandidates([]);
        setLoading(false);
        return;
      }
      // The suggest endpoint returns all affected periods; pick the one
      // matching this dialog's period.
      const periods: Array<{
        period: { id: string };
        candidates: Candidate[];
        candidate_count_total: number;
      }> = body.data?.periods ?? [];
      const match = periods.find((p) => p.period.id === period.id);
      setCandidates(match?.candidates ?? []);
      setTotalCount(match?.candidate_count_total ?? 0);
      setLoading(false);
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [open, absenceId, period.id]);

  const handleAssign = async (teacherId: string) => {
    setSubmittingId(teacherId);
    const res = await adminFetch("/api/substitutions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        absence_id: absenceId,
        timetable_period_id: period.id,
        substitute_teacher_id: teacherId,
      }),
    });
    setSubmittingId(null);
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      toast.error(body.error ?? "Failed to assign substitute");
      return;
    }
    toast.success("Substitute assigned");
    onAssigned();
    onOpenChange(false);
  };

  const cls = pickOne(period.classes);
  const subj = pickOne(period.subjects);
  const className = cls
    ? `${cls.name}${cls.section ? "-" + cls.section : ""}`
    : "?";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Pick a substitute</DialogTitle>
          <DialogDescription>
            {className} · {subj?.name ?? "—"} ·{" "}
            {formatTime(period.start_time)}–{formatTime(period.end_time)}
            {period.room ? ` · ${period.room}` : ""}
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
          </div>
        ) : !candidates || candidates.length === 0 ? (
          <div className="rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50/50 dark:bg-amber-900/20 p-4 text-sm text-amber-900 dark:text-amber-200">
            <div className="flex items-start gap-2">
              <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
              <div>
                <div className="font-medium">No free teachers at this time.</div>
                <div className="text-xs mt-1">
                  Every active teacher is either teaching another class or
                  already assigned as a substitute during this slot. Consider
                  combining classes or rescheduling.
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div className="space-y-2 max-h-[420px] overflow-y-auto">
            {totalCount > candidates.length && (
              <div className="text-xs text-gray-500 dark:text-gray-400 px-1">
                Showing top {candidates.length} of {totalCount} free teachers.
              </div>
            )}
            {candidates.map((c) => {
              const isCurrent = c.teacher.id === currentSubstituteId;
              return (
                <div
                  key={c.teacher.id}
                  className={`rounded-lg border p-3 ${
                    isCurrent
                      ? "border-emerald-300 dark:border-emerald-800 bg-emerald-50/40 dark:bg-emerald-900/15"
                      : "border-gray-200 dark:border-border bg-white dark:bg-card"
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="font-medium text-navy-900 dark:text-white truncate">
                        {c.teacher.full_name}
                        {c.teacher.employee_id ? (
                          <span className="text-gray-400 dark:text-gray-500 font-normal ml-1">
                            ({c.teacher.employee_id})
                          </span>
                        ) : null}
                      </div>
                      {c.reasons.length > 0 ? (
                        <ul className="mt-1 space-y-0.5">
                          {c.reasons.map((r, i) => (
                            <li
                              key={i}
                              className="text-xs text-gray-600 dark:text-gray-300"
                            >
                              · {r}
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <div className="text-xs text-gray-400 dark:text-gray-500 mt-1">
                          Free at this time — no specific match.
                        </div>
                      )}
                    </div>
                    <div className="flex flex-col items-end gap-2 shrink-0">
                      <span className="text-[11px] tabular-nums text-gray-400 dark:text-gray-500">
                        score {c.score}
                      </span>
                      <Button
                        size="sm"
                        variant={isCurrent ? "outline" : "default"}
                        onClick={() => handleAssign(c.teacher.id)}
                        disabled={submittingId !== null}
                      >
                        {submittingId === c.teacher.id && (
                          <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                        )}
                        {isCurrent ? (
                          <>
                            <UserCheck className="h-3 w-3 mr-1" />
                            Assigned
                          </>
                        ) : (
                          "Assign"
                        )}
                      </Button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
          >
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
