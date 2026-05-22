"use client";

import { useEffect, useState } from "react";
import { adminFetch } from "@nkps/shared/lib/admin-api";
import { Button } from "@nkps/shared/components/ui/button";
import { Input } from "@nkps/shared/components/ui/input";
import { Label } from "@nkps/shared/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@nkps/shared/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@nkps/shared/components/ui/select";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

interface AffectedPeriod {
  id: string;
  start_time: string;
  end_time: string;
  classes: { name: string; section: string | null } | { name: string; section: string | null }[] | null;
  subjects: { name: string } | { name: string }[] | null;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  teacherId: string;
  teacherName: string;
  initialDate: string;
  // Receives the new absence id + the affected-periods preview, so callers
  // can navigate straight into the substitution picker if they want to.
  onSaved: (result: { absenceId: string; affectedPeriods: AffectedPeriod[] }) => void;
}

const HALF_DAY_OPTIONS = [
  { value: "full", label: "Full day" },
  { value: "first_half", label: "First half (morning)" },
  { value: "second_half", label: "Second half (afternoon)" },
] as const;

export function MarkAbsentDialog({
  open,
  onOpenChange,
  teacherId,
  teacherName,
  initialDate,
  onSaved,
}: Props) {
  const [date, setDate] = useState(initialDate);
  const [halfDay, setHalfDay] = useState<"full" | "first_half" | "second_half">("full");
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // Reset form whenever the dialog re-opens with a new initial date.
  useEffect(() => {
    if (open) {
      setDate(initialDate);
      setHalfDay("full");
      setReason("");
    }
  }, [open, initialDate]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
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
    const body = await res.json().catch(() => ({}));
    setSubmitting(false);
    if (!res.ok) {
      toast.error(body.error ?? "Failed to mark absent");
      return;
    }
    onSaved({
      absenceId: body.data.absence.id,
      affectedPeriods: body.data.affected_periods ?? [],
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Mark {teacherName} absent</DialogTitle>
          <DialogDescription>
            Once saved, you can assign substitutes for the affected periods.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="absent-date">Date</Label>
            <Input
              id="absent-date"
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              required
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="absent-half-day">Coverage</Label>
            <Select
              value={halfDay}
              items={HALF_DAY_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
              onValueChange={(v) =>
                v && setHalfDay(v as "full" | "first_half" | "second_half")
              }
            >
              <SelectTrigger id="absent-half-day">
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
            <Label htmlFor="absent-reason">Reason (optional)</Label>
            <textarea
              id="absent-reason"
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

export type { AffectedPeriod };
