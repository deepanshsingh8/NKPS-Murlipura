"use client";

// Import history, and the first caller the revert endpoints have ever had.
//
// /api/fees/historical-revert has existed since the account-wise importer
// shipped: fully guarded, type-to-confirm, refuses when anything has been
// built on the batch. It was unreachable because the batch id lived only in a
// toast at commit time, so an hour later nobody could name the batch to undo.
// migration 115's import_batches registry is what makes this list possible.
//
// Admin-only, matching the endpoints. Editors with the 'fees' grant can run an
// import but not undo one.

import { useCallback, useEffect, useState } from "react";
import { Button } from "@nkps/shared/components/ui/button";
import { Badge } from "@nkps/shared/components/ui/badge";
import { Input } from "@nkps/shared/components/ui/input";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@nkps/shared/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@nkps/shared/components/ui/table";
import { Loader2, RotateCcw, History } from "lucide-react";
import { toast } from "sonner";
import { adminFetch } from "@nkps/shared/lib/admin-api";

interface Batch {
  id: string;
  kind: string;
  file_name: string | null;
  source_period_start: string | null;
  source_period_end: string | null;
  row_count: number;
  created_count: number;
  skipped_count: number;
  amount_total: number | null;
  created_at: string;
  created_by_name: string | null;
  reverted_at: string | null;
  reverted_by_name: string | null;
  academic_years: { name: string } | null;
}

const KIND_LABEL: Record<string, string> = {
  fees_day_book: "Day Book (Head wise)",
  fees_account_wise: "Day Book (Account wise)",
  results_greensheet: "Results (GreenSheet)",
  students_backfill: "Student roster backfill",
};

const inr = (n: number) =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(n);

export function ImportHistoryPanel({ refreshKey = 0 }: { refreshKey?: number }) {
  const [batches, setBatches] = useState<Batch[] | null>(null);
  const [target, setTarget] = useState<Batch | null>(null);
  const [confirmText, setConfirmText] = useState("");
  const [reverting, setReverting] = useState(false);

  const load = useCallback(async () => {
    const res = await adminFetch("/api/fees/import-batches?limit=25");
    if (!res.ok) {
      // A non-admin simply does not get this panel; that is not an error worth
      // shouting about on a page they otherwise have every right to be on.
      setBatches([]);
      return;
    }
    const json = await res.json();
    setBatches(json.batches ?? []);
  }, []);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  const handleRevert = async () => {
    if (!target) return;
    setReverting(true);
    try {
      const res = await adminFetch("/api/fees/historical-revert", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ batch_id: target.id, confirm_batch_id: confirmText.trim() }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Revert failed");
      toast.success(
        `Reverted ${json.deleted} payment row(s)` +
          (json.students_deleted ? `, removed ${json.students_deleted} student(s)` : "")
      );
      for (const w of json.warnings ?? []) toast.warning(w);
      setTarget(null);
      setConfirmText("");
      void load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Revert failed");
    } finally {
      setReverting(false);
    }
  };

  if (batches === null) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading import history…
      </div>
    );
  }
  if (batches.length === 0) return null;

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 text-sm font-medium">
        <History className="h-4 w-4 text-muted-foreground" />
        Import history
      </div>
      <div className="overflow-x-auto rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>When</TableHead>
              <TableHead>What</TableHead>
              <TableHead>Session</TableHead>
              <TableHead className="text-right">Rows</TableHead>
              <TableHead className="text-right">Amount</TableHead>
              <TableHead>By</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {batches.map((b) => (
              <TableRow key={b.id} className={b.reverted_at ? "opacity-60" : undefined}>
                <TableCell className="whitespace-nowrap">
                  {new Date(b.created_at).toLocaleDateString("en-IN", {
                    day: "2-digit",
                    month: "short",
                    year: "numeric",
                  })}
                </TableCell>
                <TableCell>
                  <div>{KIND_LABEL[b.kind] ?? b.kind}</div>
                  {b.file_name ? (
                    <div className="text-xs text-muted-foreground">{b.file_name}</div>
                  ) : null}
                  {b.source_period_start ? (
                    <div className="text-xs text-muted-foreground">
                      covers {b.source_period_start} to {b.source_period_end}
                    </div>
                  ) : null}
                </TableCell>
                <TableCell>{b.academic_years?.name ?? "—"}</TableCell>
                <TableCell className="text-right tabular-nums">
                  {b.created_count}
                  {b.skipped_count ? (
                    <span className="text-muted-foreground"> (+{b.skipped_count} skipped)</span>
                  ) : null}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {b.amount_total != null ? inr(Number(b.amount_total)) : "—"}
                </TableCell>
                <TableCell>{b.created_by_name ?? "—"}</TableCell>
                <TableCell className="text-right">
                  {b.reverted_at ? (
                    <Badge variant="outline">
                      Reverted{b.reverted_by_name ? ` by ${b.reverted_by_name}` : ""}
                    </Badge>
                  ) : (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setTarget(b);
                        setConfirmText("");
                      }}
                    >
                      <RotateCcw className="mr-2 h-4 w-4" />
                      Revert
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <Dialog
        open={target !== null}
        onOpenChange={(next) => {
          if (!next) {
            setTarget(null);
            setConfirmText("");
          }
        }}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Revert this import?</DialogTitle>
            <DialogDescription>
              This permanently deletes the {target?.created_count} payment row(s) this
              batch created
              {target?.amount_total != null
                ? ` — ${inr(Number(target.amount_total))}`
                : ""}
              , along with any students and enrollments it created. It is refused if
              anything has been built on those rows since.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">
              Type the batch id to confirm:
            </p>
            <code className="block select-all rounded bg-muted px-2 py-1 text-xs">
              {target?.id}
            </code>
            <Input
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              placeholder="Paste the batch id here"
            />
          </div>
          <DialogFooter>
            <DialogClose render={<Button variant="outline">Cancel</Button>} />
            <Button
              variant="destructive"
              disabled={reverting || confirmText.trim() !== target?.id}
              onClick={handleRevert}
            >
              {reverting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Revert permanently
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
