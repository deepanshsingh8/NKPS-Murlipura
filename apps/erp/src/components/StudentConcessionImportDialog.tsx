"use client";

import { useCallback, useRef, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@nkps/shared/components/ui/dialog";
import { Button } from "@nkps/shared/components/ui/button";
import { Label } from "@nkps/shared/components/ui/label";
import { Badge } from "@nkps/shared/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@nkps/shared/components/ui/table";
import { adminFetch } from "@nkps/shared/lib/admin-api";
import { csvEscape } from "@nkps/shared/lib/utils";
import { toast } from "sonner";
import { Loader2, Percent, AlertCircle, CheckCircle2 } from "lucide-react";

interface RowVerdict {
  source_row: number;
  admission_no: string;
  student_name: string;
  fee_type: string;
  due_date: string | null;
  amount: number | null;
  reason: string;
  month: string | null;
  status: "ok" | "error";
  message?: string;
}

interface Preview {
  rows: RowVerdict[];
  summary: { total: number; errors: number; total_amount: number };
}

const inr = (n: number) =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(n);

/**
 * Bulk per-student concessions (staff wards, RTE, sibling discounts).
 *
 * Each row becomes the same waiver receipt the single-student Waiver button
 * writes, so dues, no-dues certificates and receipts all account for it
 * without learning about a new kind of discount. Every row is checked against
 * the live ledger both in preview and again at import, so a concession can
 * never exceed what is actually still owed.
 */
export function StudentConcessionImportDialog({
  onImported,
}: {
  onImported?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [loading, setLoading] = useState(false);
  const [committing, setCommitting] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const reset = useCallback(() => {
    setFile(null);
    setPreview(null);
    if (fileRef.current) fileRef.current.value = "";
  }, []);

  async function send(dryRun: boolean) {
    if (!file) return;
    const fd = new FormData();
    fd.append("file", file);
    fd.append("dry_run", String(dryRun));
    return adminFetch("/api/fees/waivers/import", { method: "POST", body: fd });
  }

  async function handlePreview() {
    setLoading(true);
    setPreview(null);
    try {
      const res = await send(true);
      if (!res) return;
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? "Could not read that file");
        return;
      }
      setPreview(data as Preview);
    } catch {
      toast.error("Could not read that file");
    } finally {
      setLoading(false);
    }
  }

  async function handleCommit() {
    if (!preview || preview.summary.errors > 0) return;
    setCommitting(true);
    try {
      const res = await send(false);
      if (!res) return;
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? "Import failed");
        return;
      }
      if (data.failed > 0) {
        // Partial: say so plainly rather than reporting success.
        toast.warning(
          `Recorded ${data.inserted} concession(s); ${data.failed} could not be applied.`
        );
      } else {
        toast.success(
          `Recorded ${data.inserted} concession(s) totalling ${inr(data.total_amount ?? 0)}`
        );
      }
      reset();
      setOpen(false);
      onImported?.();
    } catch {
      toast.error("Import failed");
    } finally {
      setCommitting(false);
    }
  }

  function downloadErrorReport() {
    if (!preview) return;
    const bad = preview.rows.filter((r) => r.status === "error");
    const csv = [
      ["Row", "Admission No", "Name", "Fee Head", "Due Date", "Amount", "Problem"]
        .map(csvEscape)
        .join(","),
      ...bad.map((r) =>
        [
          r.source_row,
          r.admission_no,
          r.student_name,
          r.fee_type,
          r.due_date ?? "",
          r.amount ?? "",
          r.message ?? "",
        ]
          .map((v) => csvEscape(String(v)))
          .join(",")
      ),
    ].join("\n");
    const url = URL.createObjectURL(
      new Blob([csv], { type: "text/csv;charset=utf-8;" })
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = "concession-import-errors.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  const errors = preview?.summary.errors ?? 0;

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) reset();
      }}
    >
      <DialogTrigger render={<Button type="button" variant="outline" size="sm" />}>
        <Percent className="h-4 w-4 mr-2" />
        Bulk concessions
      </DialogTrigger>
      <DialogContent className="sm:max-w-4xl max-h-[88dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Bulk upload student concessions</DialogTitle>
          <DialogDescription>
            Record a concession against individual students — staff wards, RTE,
            sibling discounts — by admission number. Each one is applied to a
            specific instalment and shows up on dues and no-dues exactly like a
            waiver recorded by hand, because that is what it is.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <div className="flex items-center justify-between">
              <Label htmlFor="cn-file" className="text-xs">
                XLSX file
              </Label>
              <a
                href="/api/fees/waivers/import/template"
                className="text-xs text-blue-600 dark:text-blue-400 hover:underline"
              >
                Download template
              </a>
            </div>
            <input
              id="cn-file"
              ref={fileRef}
              type="file"
              accept=".xlsx,.xls"
              onChange={(e) => {
                setFile(e.target.files?.[0] ?? null);
                setPreview(null);
              }}
              className="mt-1 block w-full text-sm text-gray-500 dark:text-gray-400 file:mr-2 file:rounded-md file:border-0 file:bg-navy-900 file:px-3 file:py-1.5 file:text-xs file:text-white hover:file:bg-navy-900/90"
            />
          </div>

          {!preview && (
            <Button onClick={handlePreview} disabled={!file || loading}>
              {loading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Preview
            </Button>
          )}

          {preview && (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <Badge
                  variant="secondary"
                  className="bg-green-100 text-green-700 dark:bg-green-950/30 dark:text-green-400"
                >
                  <CheckCircle2 className="h-3 w-3 mr-1" />
                  {preview.summary.total - errors} valid
                </Badge>
                {errors > 0 && (
                  <Badge
                    variant="secondary"
                    className="bg-red-100 text-red-700 dark:bg-red-950/30 dark:text-red-400"
                  >
                    <AlertCircle className="h-3 w-3 mr-1" />
                    {errors} error{errors === 1 ? "" : "s"}
                  </Badge>
                )}
                <Badge variant="outline">
                  {inr(preview.summary.total_amount)} total
                </Badge>
                {errors > 0 && (
                  <Button variant="outline" size="sm" onClick={downloadErrorReport}>
                    Download error report
                  </Button>
                )}
              </div>

              <div className="max-h-[40dvh] overflow-y-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-14">Row</TableHead>
                      <TableHead className="w-24">Adm No</TableHead>
                      <TableHead>Student</TableHead>
                      <TableHead>Fee Head</TableHead>
                      <TableHead className="w-28">Due</TableHead>
                      <TableHead className="w-24">Amount</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {preview.rows.map((r) => (
                      <TableRow
                        key={r.source_row}
                        className={
                          r.status === "error"
                            ? "bg-red-50/60 dark:bg-red-950/20"
                            : undefined
                        }
                      >
                        <TableCell className="text-xs text-gray-400">
                          {r.source_row}
                        </TableCell>
                        <TableCell className="text-sm">{r.admission_no}</TableCell>
                        <TableCell className="text-sm">{r.student_name || "—"}</TableCell>
                        <TableCell className="text-sm">{r.fee_type}</TableCell>
                        <TableCell className="text-sm">{r.due_date ?? "—"}</TableCell>
                        <TableCell className="text-sm">
                          {r.amount !== null ? inr(r.amount) : "—"}
                        </TableCell>
                        <TableCell className="text-xs">
                          {r.status === "error" ? (
                            <span className="text-red-600 dark:text-red-400">
                              {r.message}
                            </span>
                          ) : (
                            <span className="text-green-600 dark:text-green-400">OK</span>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              <div className="flex items-center gap-2">
                <Button onClick={handleCommit} disabled={committing || errors > 0}>
                  {committing && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                  Record {preview.summary.total - errors} concession
                  {preview.summary.total - errors === 1 ? "" : "s"}
                </Button>
                <Button variant="outline" onClick={reset} disabled={committing}>
                  Choose a different file
                </Button>
                {errors > 0 && (
                  <p className="text-xs text-red-600 dark:text-red-400">
                    Fix every error row and re-upload — nothing is imported
                    while any row is invalid.
                  </p>
                )}
              </div>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
