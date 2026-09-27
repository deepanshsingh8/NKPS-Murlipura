"use client";

import { useCallback, useEffect, useRef, useState } from "react";
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
import { createClient } from "@nkps/shared/lib/supabase/client";
import { adminFetch } from "@nkps/shared/lib/admin-api";
import { csvEscape } from "@nkps/shared/lib/utils";
import { toast } from "sonner";
import { Loader2, FileSpreadsheet, AlertCircle, CheckCircle2 } from "lucide-react";
import { NativeSelect } from "@nkps/shared/components/ui/native-select";

interface RowVerdict {
  source_row: number;
  class_name: string;
  stream_name: string | null;
  fee_type: string;
  instalment_name: string | null;
  amount: number | null;
  due_date: string | null;
  student_type: string;
  status: "ok" | "warning" | "error";
  message?: string;
}

interface Bucket {
  class_name: string;
  stream_id: string | null;
  stream_name: string | null;
  row_count: number;
  replaces_existing: number;
  payload: unknown;
}

interface Preview {
  academic_year: { id: string; name: string };
  unrecognized_headers: string[];
  rows: RowVerdict[];
  summary: { total: number; errors: number; buckets: number };
  buckets: Bucket[];
}

/**
 * Bulk-upload a fee schedule for many classes at once.
 *
 * Preview first, commit second, and a file with any error row cannot be
 * committed at all — a half-applied fee schedule is worse than none, because
 * the classes that did land start billing against it immediately.
 *
 * The commit loops the (class, stream) buckets through the EXISTING
 * POST /api/fees/schedule rather than writing rows itself, so the
 * insert/update/deactivate rules — including the fallback that keeps rows
 * with issued receipts resolvable — stay in one place.
 */
export function FeeScheduleImportDialog({
  onImported,
}: {
  onImported?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [years, setYears] = useState<{ id: string; name: string }[]>([]);
  const [academicYearId, setAcademicYearId] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [loading, setLoading] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    const supabase = createClient();
    (async () => {
      const { data } = await supabase
        .from("academic_years")
        .select("id, name, is_current")
        .order("start_date", { ascending: false });
      setYears(data ?? []);
      const current = data?.find((y) => y.is_current);
      if (current && !academicYearId) setAcademicYearId(current.id);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const reset = useCallback(() => {
    setFile(null);
    setPreview(null);
    setProgress(null);
    if (fileRef.current) fileRef.current.value = "";
  }, []);

  async function handlePreview() {
    if (!file || !academicYearId) return;
    setLoading(true);
    setPreview(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("academic_year_id", academicYearId);
      const res = await adminFetch("/api/fees/schedule/import", {
        method: "POST",
        body: fd,
      });
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
    let done = 0;
    try {
      for (const bucket of preview.buckets) {
        const label = `${bucket.class_name}${bucket.stream_name ? ` (${bucket.stream_name})` : ""}`;
        setProgress(`Saving ${label} — ${done + 1} of ${preview.buckets.length}…`);
        const res = await adminFetch("/api/fees/schedule", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(bucket.payload),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          // Say exactly how far it got: the classes already saved are live.
          toast.error(
            `Stopped at ${label}: ${body.error ?? "save failed"}. ${done} class(es) were already saved.`
          );
          return;
        }
        done += 1;
      }
      toast.success(
        `Imported fee schedules for ${done} class${done === 1 ? "" : "es"}`
      );
      reset();
      setOpen(false);
      onImported?.();
    } catch {
      toast.error(`Import failed after saving ${done} class(es)`);
    } finally {
      setCommitting(false);
      setProgress(null);
    }
  }

  function downloadErrorReport() {
    if (!preview) return;
    const bad = preview.rows.filter((r) => r.status === "error");
    const header = [
      "Row",
      "Class",
      "Stream",
      "Fee Head",
      "Instalment",
      "Amount",
      "Due Date",
      "Student Type",
      "Problem",
    ];
    const csv = [
      header.map(csvEscape).join(","),
      ...bad.map((r) =>
        [
          r.source_row,
          r.class_name,
          r.stream_name ?? "",
          r.fee_type,
          r.instalment_name ?? "",
          r.amount ?? "",
          r.due_date ?? "",
          r.student_type,
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
    a.download = "fee-schedule-import-errors.csv";
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
      <DialogTrigger
        render={<Button type="button" variant="outline" size="sm" />}
      >
        <FileSpreadsheet className="h-4 w-4 mr-2" />
        Bulk upload schedule
      </DialogTrigger>
      <DialogContent className="sm:max-w-4xl max-h-[88dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Bulk upload fee schedules</DialogTitle>
          <DialogDescription>
            Upload one sheet covering every class&apos;s instalment schedule.
            Each class block <strong>replaces</strong> that class&apos;s
            schedule for the session — rows you leave out are removed, except
            where a receipt already references them, which are deactivated
            instead so past receipts stay readable.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <Label htmlFor="fs-year" className="text-xs">
                Academic year
              </Label>
              <NativeSelect
                id="fs-year"
                value={academicYearId}
                onChange={(e) => {
                  setAcademicYearId(e.target.value);
                  setPreview(null);
                }}
                className="mt-1 block w-full"
              >
                {years.map((y) => (
                  <option key={y.id} value={y.id}>
                    {y.name}
                  </option>
                ))}
              </NativeSelect>
            </div>
            <div>
              <div className="flex items-center justify-between">
                <Label htmlFor="fs-file" className="text-xs">
                  XLSX file
                </Label>
                <a
                  href="/api/fees/schedule/import/template"
                  className="text-xs text-blue-600 dark:text-blue-400 hover:underline"
                >
                  Download template
                </a>
              </div>
              <input
                id="fs-file"
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
          </div>

          {!preview && (
            <Button onClick={handlePreview} disabled={!file || !academicYearId || loading}>
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
                  {preview.summary.buckets} class block
                  {preview.summary.buckets === 1 ? "" : "s"}
                </Badge>
                {errors > 0 && (
                  <Button variant="outline" size="sm" onClick={downloadErrorReport}>
                    Download error report
                  </Button>
                )}
              </div>

              {preview.unrecognized_headers.length > 0 && (
                <p className="text-xs text-amber-700 dark:text-amber-400">
                  Ignored column{preview.unrecognized_headers.length === 1 ? "" : "s"}:{" "}
                  {preview.unrecognized_headers.join(", ")} — check for a typo if
                  you expected them to be read.
                </p>
              )}

              {/* What each class block will do, before it does it. */}
              <div className="rounded-lg border border-gray-200 dark:border-border p-3 space-y-1">
                {preview.buckets.map((b) => (
                  <p
                    key={`${b.class_name}|${b.stream_id ?? ""}`}
                    className="text-xs text-gray-600 dark:text-gray-300"
                  >
                    <strong>
                      Class {b.class_name}
                      {b.stream_name ? ` (${b.stream_name})` : ""}
                    </strong>{" "}
                    — {b.row_count} row{b.row_count === 1 ? "" : "s"}
                    {b.replaces_existing > 0 ? (
                      <span className="text-amber-700 dark:text-amber-400">
                        {" "}
                        · replaces {b.replaces_existing} existing row
                        {b.replaces_existing === 1 ? "" : "s"}
                      </span>
                    ) : (
                      <span className="text-green-700 dark:text-green-400">
                        {" "}
                        · new schedule
                      </span>
                    )}
                  </p>
                ))}
              </div>

              <div className="max-h-[38dvh] overflow-y-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-14">Row</TableHead>
                      <TableHead>Class</TableHead>
                      <TableHead>Fee Head</TableHead>
                      <TableHead>Instalment</TableHead>
                      <TableHead className="w-24">Amount</TableHead>
                      <TableHead className="w-28">Due</TableHead>
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
                        <TableCell className="text-sm">
                          {r.class_name}
                          {r.stream_name ? ` (${r.stream_name})` : ""}
                        </TableCell>
                        <TableCell className="text-sm">{r.fee_type}</TableCell>
                        <TableCell className="text-sm text-gray-500 dark:text-gray-400">
                          {r.instalment_name ?? "—"}
                        </TableCell>
                        <TableCell className="text-sm">
                          {r.amount ?? "—"}
                        </TableCell>
                        <TableCell className="text-sm">
                          {r.due_date ?? "—"}
                        </TableCell>
                        <TableCell className="text-xs">
                          {r.status === "error" ? (
                            <span className="text-red-600 dark:text-red-400">
                              {r.message}
                            </span>
                          ) : (
                            <span className="text-green-600 dark:text-green-400">
                              OK
                            </span>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              {progress && (
                <p className="text-xs text-gray-500 dark:text-gray-400">{progress}</p>
              )}

              <div className="flex items-center gap-2">
                <Button
                  onClick={handleCommit}
                  disabled={committing || errors > 0 || preview.buckets.length === 0}
                >
                  {committing && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                  Import {preview.summary.buckets} class block
                  {preview.summary.buckets === 1 ? "" : "s"}
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
