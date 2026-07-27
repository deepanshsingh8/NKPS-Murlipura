"use client";

import { useState } from "react";
import { Input } from "@nkps/shared/components/ui/input";
import { Label } from "@nkps/shared/components/ui/label";
import { Button } from "@nkps/shared/components/ui/button";
import { Loader2, Link2 } from "lucide-react";
import { toast } from "sonner";

// Shown on the student dashboard when the logged-in account is not yet
// connected to a student record. The student verifies with their admission
// number + date of birth (same check as the parent link flow) and the account
// links itself via /api/students/link-self.
export function StudentLinkPrompt({ onLinked }: { onLinked: () => void }) {
  const [admissionNo, setAdmissionNo] = useState("");
  const [dob, setDob] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!admissionNo.trim() || !dob) return;
    setSubmitting(true);
    try {
      const res = await fetch("/api/students/link-self", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ admission_no: admissionNo.trim(), date_of_birth: dob }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error ?? "Could not connect your account");
        return;
      }
      toast.success(
        `Connected to ${data.student?.full_name ?? "your record"}. Loading your dashboard…`
      );
      onLinked();
    } catch {
      toast.error("Could not connect your account");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="rounded-2xl border border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/20 p-5">
      <div className="flex items-center gap-3 mb-2">
        <div className="h-10 w-10 rounded-xl bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center">
          <Link2 className="h-5 w-5 text-amber-600 dark:text-amber-400" />
        </div>
        <div>
          <h2 className="font-heading text-lg font-semibold text-navy-900 dark:text-white">
            Connect your account
          </h2>
          <p className="text-sm text-amber-700 dark:text-amber-300/80">
            Enter your admission number and date of birth to link your login to your
            student record.
          </p>
        </div>
      </div>

      <form onSubmit={submit} className="grid grid-cols-1 sm:grid-cols-[1fr_1fr_auto] gap-3 mt-3 items-end">
        <div className="erp-form-group">
          <Label htmlFor="claimAdmission">Admission number</Label>
          <Input
            id="claimAdmission"
            value={admissionNo}
            onChange={(e) => setAdmissionNo(e.target.value)}
            placeholder="e.g. NKPS-1023"
            className="h-10 bg-white dark:bg-card"
            required
          />
        </div>
        <div className="erp-form-group">
          <Label htmlFor="claimDob">Date of birth</Label>
          <Input
            id="claimDob"
            type="date"
            value={dob}
            onChange={(e) => setDob(e.target.value)}
            className="h-10 bg-white dark:bg-card"
            required
          />
        </div>
        <Button
          type="submit"
          disabled={submitting || !admissionNo.trim() || !dob}
          className="h-10 bg-navy-900 hover:bg-navy-800 text-white"
        >
          {submitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
          Connect
        </Button>
      </form>
    </div>
  );
}
