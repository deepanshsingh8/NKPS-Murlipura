"use client";

import { useCallback, useEffect, useState } from "react";
import { adminFetch } from "@nkps/shared/lib/admin-api";
import { Button } from "@nkps/shared/components/ui/button";
import { Badge } from "@nkps/shared/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@nkps/shared/components/ui/dialog";
import { toast } from "sonner";
import { AlertTriangle, Check, Loader2 } from "lucide-react";

/**
 * Preview, then apply, a wing's subject set across its class band.
 *
 * A dry run first because this touches every section of every class in the
 * band — nine classes for Middle Wing — and a single unconfirmed click is the
 * wrong shape for that. Follows QuickSetupWizard's preview-then-commit.
 *
 * The apply never removes anything and never overwrites a teacher, so re-running
 * it on a band that is already partly set up is safe; the preview says how much
 * is already there.
 */
interface Preview {
  wing: string;
  classes: string[];
  subject_count: number;
  would_create: number;
  skipped: number;
}

export function WingApplyDialog({
  open,
  onOpenChange,
  wingId,
  wingName,
  academicYearId,
  onApplied,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  wingId: string;
  wingName: string;
  academicYearId?: string;
  onApplied: () => void;
}) {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState(false);

  const post = useCallback(
    async (dryRun: boolean) => {
      const res = await adminFetch("/api/subjects/apply-wing", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          stream_id: wingId,
          academic_year_id: academicYearId,
          dry_run: dryRun,
        }),
      });
      const body = await res.json().catch(() => ({}));
      return { ok: res.ok, body };
    },
    [wingId, academicYearId]
  );

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setPreview(null);
    setError(null);
    setLoading(true);
    post(true).then(({ ok, body }) => {
      if (cancelled) return;
      if (!ok) setError(body.error ?? "Could not work out what this would do");
      else setPreview(body as Preview);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [open, post]);

  const apply = async () => {
    setApplying(true);
    const { ok, body } = await post(false);
    setApplying(false);
    if (!ok) {
      toast.error(body.error ?? "Failed to apply the wing");
      return;
    }
    const created = body.created ?? 0;
    toast.success(
      created === 0
        ? `Nothing new to add — ${wingName}'s classes already have these subjects`
        : `Added ${created} subject assignment${created === 1 ? "" : "s"} across ${body.classes?.length ?? 0} classes`
    );
    onApplied();
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <div>
            <DialogTitle>Apply {wingName} to its classes</DialogTitle>
            <p className="text-xs text-gray-500 mt-0.5">
              Gives every class in the band this wing&apos;s subjects.
            </p>
          </div>
        </DialogHeader>

        {loading && (
          <div className="flex justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
          </div>
        )}

        {error && (
          <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50/70 px-3 py-2.5 text-sm text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/20 dark:text-amber-200">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {preview && (
          <div className="space-y-3 text-sm">
            <div>
              <p className="mb-1.5 text-xs font-medium text-gray-500 dark:text-gray-400">
                {preview.classes.length} class
                {preview.classes.length === 1 ? "" : "es"} in this band
              </p>
              <div className="flex flex-wrap gap-1.5">
                {preview.classes.map((c) => (
                  <Badge key={c} variant="secondary" className="text-xs">
                    {c}
                  </Badge>
                ))}
              </div>
            </div>

            <div className="rounded-lg bg-gray-50 px-3 py-2.5 dark:bg-muted">
              <p className="text-gray-700 dark:text-gray-200">
                <strong>{preview.would_create}</strong> subject assignment
                {preview.would_create === 1 ? "" : "s"} will be created
                {preview.skipped > 0 && (
                  <>
                    {" "}
                    · <strong>{preview.skipped}</strong> already there
                  </>
                )}
              </p>
              <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                {preview.subject_count} subject
                {preview.subject_count === 1 ? "" : "s"} × {preview.classes.length}{" "}
                class{preview.classes.length === 1 ? "" : "es"}. Nothing is
                removed, and any teacher already set on an existing assignment
                is left alone.
              </p>
            </div>

            {preview.would_create === 0 && (
              <p className="text-xs text-gray-500 dark:text-gray-400">
                Every class in the band already has all of these subjects —
                applying again would change nothing.
              </p>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={apply}
            disabled={applying || loading || !preview || preview.would_create === 0}
            className="bg-navy-900 hover:bg-navy-800 text-white"
          >
            {applying && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            <Check className="h-4 w-4 mr-1" />
            Apply to {preview?.classes.length ?? 0} classes
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
