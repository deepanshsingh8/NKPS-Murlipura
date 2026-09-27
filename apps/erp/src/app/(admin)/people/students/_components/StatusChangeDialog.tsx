"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@nkps/shared/components/ui/dialog";
import { Button } from "@nkps/shared/components/ui/button";
import { Label } from "@nkps/shared/components/ui/label";
import { Textarea } from "@nkps/shared/components/ui/textarea";
import { Input } from "@nkps/shared/components/ui/input";
import { todayISO } from "@nkps/shared/lib/date";
import type { EnrollmentStatus } from "@nkps/shared/types";

export const MIN_REASON_LENGTH = 5;

// Only the two ending states demand a justification. Passed/failed/active are
// routine year-end bookkeeping and would just train people to type "ok".
export const REASON_REQUIRED_STATUSES: EnrollmentStatus[] = [
  "terminated",
  "exited",
];

export function statusNeedsReason(status: EnrollmentStatus): boolean {
  return REASON_REQUIRED_STATUSES.includes(status);
}

const STATUS_LABEL: Record<string, string> = {
  terminated: "Terminated",
  exited: "Exited",
};

export interface StatusChangeRequest {
  status: EnrollmentStatus;
  /** Single-student change. */
  student?: { id: string; full_name: string; enrollment_id: string };
  /** Bulk change — enrollment ids of the current selection. */
  enrollmentIds?: string[];
}

interface StatusChangeDialogProps {
  request: StatusChangeRequest | null;
  onOpenChange: (open: boolean) => void;
  onConfirm: (reason: string, exitDate: string) => Promise<void>;
}

/**
 * Confirms a status change into Terminated/Exited and collects the reason and
 * the leaving date.
 *
 * The reason is the deliverable here, not a nicety: without it nobody can say
 * a year later why a student left. Bulk changes share one reason — a form
 * asking for fifteen separate justifications gets fifteen copies of "left".
 *
 * The date is the deliverable for the money side. Dues are computed from the
 * schedule against the calendar, so until something says when a student left,
 * the next quarter's instalment is raised against them, and the one after
 * that — arrears nobody intends to collect, sitting in the register and in
 * every total drawn from it. This date is where their billing stops
 * (migration 123). It defaults to today because most exits are recorded as
 * they happen; back-date it when the paperwork has lagged.
 */
export function StatusChangeDialog({
  request,
  onOpenChange,
  onConfirm,
}: StatusChangeDialogProps) {
  const [reason, setReason] = useState("");
  const [exitDate, setExitDate] = useState(todayISO());
  const [saving, setSaving] = useState(false);

  // Clear between openings so a previous reason can't be submitted by accident.
  useEffect(() => {
    if (request) {
      setReason("");
      setExitDate(todayISO());
    }
  }, [request]);

  const count = request?.enrollmentIds?.length ?? 1;
  const isBulk = Boolean(request?.enrollmentIds);
  const label = request ? (STATUS_LABEL[request.status] ?? request.status) : "";
  const tooShort = reason.trim().length < MIN_REASON_LENGTH;
  // A future date would bill the student for instalments that have not been
  // raised yet, which is the opposite of what this field is for.
  const dateInvalid = !exitDate || exitDate > todayISO();

  const handleConfirm = async () => {
    if (tooShort || dateInvalid || saving) return;
    setSaving(true);
    try {
      await onConfirm(reason.trim(), exitDate);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={Boolean(request)} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {isBulk
              ? `Mark ${count} student${count === 1 ? "" : "s"} as ${label}?`
              : `Mark ${request?.student?.full_name ?? "this student"} as ${label}?`}
          </DialogTitle>
          <p className="text-xs text-gray-500 dark:text-gray-400">
            {isBulk
              ? "This reason is recorded against every selected student and stays on their record permanently."
              : "This is recorded against the student permanently, so it can be looked up later."}
          </p>
        </DialogHeader>

        <div className="space-y-3 py-2">
          <div className="space-y-1">
            <Label className="text-xs font-medium" htmlFor="status-exit-date">
              Last day on the roll *
            </Label>
            <Input
              id="status-exit-date"
              type="date"
              value={exitDate}
              max={todayISO()}
              onChange={(e) => setExitDate(e.target.value)}
            />
            <p className="text-[11px] text-gray-500 dark:text-gray-400">
              {dateInvalid
                ? "Pick a date on or before today."
                : isBulk
                  ? "Fees due after this date will not be charged to any of these students."
                  : "Fees due after this date will not be charged. Instalments already due by then still stand."}
            </p>
          </div>

          <div className="space-y-1">
            <Label className="text-xs font-medium" htmlFor="status-reason">
              Reason *
            </Label>
            <Textarea
              id="status-reason"
              rows={3}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={
                request?.status === "terminated"
                  ? "e.g. Dismissed for repeated disciplinary action — TC issued 12/08/2026"
                  : "e.g. Family relocated to Jaipur — TC issued 12/08/2026"
              }
              maxLength={500}
            />
            <p className="text-[11px] text-gray-500 dark:text-gray-400">
              At least {MIN_REASON_LENGTH} characters. {reason.trim().length}/500
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={saving}
          >
            Cancel
          </Button>
          <Button onClick={handleConfirm} disabled={saving || tooShort || dateInvalid}>
            {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Mark as {label}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
