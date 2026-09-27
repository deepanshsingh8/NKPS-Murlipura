"use client";

import { useState } from "react";
import { CalendarClock, Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@nkps/shared/components/ui/dialog";
import { Button } from "@nkps/shared/components/ui/button";
import { Label } from "@nkps/shared/components/ui/label";
import { Input } from "@nkps/shared/components/ui/input";
import { Textarea } from "@nkps/shared/components/ui/textarea";
import { todayISO } from "@nkps/shared/lib/date";

export interface ExitDateRequest {
  enrollment_id: string;
  full_name: string;
  /** Current leaving date, or null where the exit predates the column. */
  exit_date: string | null;
  status: string;
}

interface ExitDateDialogProps {
  request: ExitDateRequest | null;
  onOpenChange: (open: boolean) => void;
  onConfirm: (exitDate: string, note: string) => Promise<void>;
}

/**
 * Corrects the leaving date on a student who has already left.
 *
 * The date is collected when a student is marked Exited/Terminated, but it is
 * also backfilled for everyone who left before it existed — and where the
 * paperwork lagged, that backfill lands on the day the exit was TYPED rather
 * than the day the child actually left. Since it is the fee billing cutoff, a
 * date two months late is two months of instalments the family never owed.
 *
 * Re-selecting a status a student already holds is a no-op, so there was no
 * way to reach this from the status control — hence a dialog of its own.
 *
 * The form is a child keyed on the enrollment so opening a different student
 * remounts it with their date already in the field. That is what a reset
 * effect would have been for, without the cascading render it costs.
 */
export function ExitDateDialog({
  request,
  onOpenChange,
  onConfirm,
}: ExitDateDialogProps) {
  return (
    <Dialog open={Boolean(request)} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        {request && (
          <ExitDateForm
            key={request.enrollment_id}
            request={request}
            onCancel={() => onOpenChange(false)}
            onConfirm={onConfirm}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function ExitDateForm({
  request,
  onCancel,
  onConfirm,
}: {
  request: ExitDateRequest;
  onCancel: () => void;
  onConfirm: (exitDate: string, note: string) => Promise<void>;
}) {
  const [exitDate, setExitDate] = useState(request.exit_date ?? todayISO());
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  // A future date would bill instalments that have not been raised yet — the
  // opposite of what this field is for. The API and the RPC refuse it too;
  // this is just the earliest place to say so.
  const invalid = !exitDate || exitDate > todayISO();
  const unchanged = exitDate === (request.exit_date ?? "");

  const handleConfirm = async () => {
    if (invalid || unchanged || saving) return;
    setSaving(true);
    try {
      await onConfirm(exitDate, note.trim());
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <DialogHeader>
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 shrink-0 rounded-xl bg-amber-100 dark:bg-amber-950/30 flex items-center justify-center">
            <CalendarClock className="h-5 w-5 text-amber-600 dark:text-amber-400" />
          </div>
          <div>
            <DialogTitle>Leaving date</DialogTitle>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
              {request.full_name}
            </p>
          </div>
        </div>
      </DialogHeader>

      <div className="space-y-3 py-2">
        <div className="space-y-1">
          <Label className="text-xs font-medium" htmlFor="exit-date-input">
            Last day on the roll *
          </Label>
          <Input
            id="exit-date-input"
            type="date"
            value={exitDate}
            max={todayISO()}
            onChange={(e) => setExitDate(e.target.value)}
          />
          <p className="text-[11px] text-gray-500 dark:text-gray-400">
            {invalid
              ? "Pick a date on or before today."
              : "Fees due after this date are not charged. Moving it earlier drops instalments already counted against this student; moving it later adds them back."}
          </p>
          {!request.exit_date && (
            <p className="text-[11px] text-amber-700 dark:text-amber-400">
              No leaving date is on record for this student, so they are still
              being billed to today. Setting one stops that.
            </p>
          )}
        </div>

        <div className="space-y-1">
          <Label className="text-xs font-medium" htmlFor="exit-date-note">
            Note (optional)
          </Label>
          <Textarea
            id="exit-date-note"
            rows={2}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="e.g. TC records last attended as 30/06/2026"
            maxLength={400}
          />
          <p className="text-[11px] text-gray-500 dark:text-gray-400">
            The change is recorded against the student either way. A note says
            why, for whoever reads it later.
          </p>
        </div>
      </div>

      <DialogFooter>
        <Button variant="outline" onClick={onCancel} disabled={saving}>
          Cancel
        </Button>
        <Button onClick={handleConfirm} disabled={saving || invalid || unchanged}>
          {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
          {unchanged ? "No change" : "Save leaving date"}
        </Button>
      </DialogFooter>
    </>
  );
}
