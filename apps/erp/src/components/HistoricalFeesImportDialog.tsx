"use client";

// Historical fees bulk-import dialog.
//
// Flow:
//   1. Admin picks an academic year and uploads a "Day Book (Account Wise)"
//      XLSX exported from the previous ERP software.
//   2. "Preview" runs the server in dry-run mode. Server returns row results
//      plus a list of distinct raw_class names it could not normalize.
//   3. If any classes are unmapped, the dialog renders a mini-form letting
//      the admin pick an ERP class (and optional stream) for each unknown
//      name. Submitting re-runs the preview with the mapping baked in.
//   4. Once preview is clean (zero errors, zero unmapped classes), "Import"
//      commits the batch.
//
// Auth: explicit Bearer token from supabase.auth.getSession() — same pattern
// the publish-marksheet flow uses.

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@nkps/shared/components/ui/dialog";
import { Button } from "@nkps/shared/components/ui/button";
import { Badge } from "@nkps/shared/components/ui/badge";
import { Label } from "@nkps/shared/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@nkps/shared/components/ui/table";
import {
  Upload,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  History,
} from "lucide-react";
import { toast } from "sonner";
import { createClient } from "@nkps/shared/lib/supabase/client";

interface AcademicYear {
  id: string;
  name: string;
}

interface RowResult {
  source_row: number;
  raw_class: string;
  raw_section: string;
  admission_no: string | null;
  student_name: string;
  payments_count: number;
  total: number;
  ok: boolean;
  error?: string;
  matched_by?: "admission_no" | "name_fallback";
}

interface WillCreateClass {
  name: string;
  section: string;
  stream_name: string | null;
}

interface Summary {
  total_rows: number;
  ok_rows: number;
  error_rows: number;
  payments_to_create: number;
  dry_run: boolean;
  committed?: boolean | number;
  batch_id?: string;
  skipped_conflicts?: number;
  unmapped_classes: string[];
  will_create_streams?: string[];
  will_create_classes?: WillCreateClass[];
}

interface ClassMappingValue {
  class_name: string;
  stream_name: "Science" | "Commerce" | "Arts" | null;
}

const ROMAN_CLASSES = [
  "Nursery",
  "LKG",
  "UKG",
  "I",
  "II",
  "III",
  "IV",
  "V",
  "VI",
  "VII",
  "VIII",
  "IX",
  "X",
  "XI",
  "XII",
];
const STREAMS = ["", "Science", "Commerce", "Arts"];

interface Props {
  triggerLabel?: string;
  onImported?: () => void;
}

export function HistoricalFeesImportDialog({
  triggerLabel = "Bulk import historical fees",
  onImported,
}: Props) {
  const [open, setOpen] = useState(false);
  const [years, setYears] = useState<AcademicYear[]>([]);
  const [academicYearId, setAcademicYearId] = useState<string>("");
  const [file, setFile] = useState<File | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [rows, setRows] = useState<RowResult[] | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [unmapped, setUnmapped] = useState<string[]>([]);
  const [mappings, setMappings] = useState<Record<string, ClassMappingValue>>({});
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    void (async () => {
      const supabase = createClient();
      const { data } = await supabase
        .from("academic_years")
        .select("id, name")
        .order("name", { ascending: false });
      const list = (data ?? []) as AcademicYear[];
      setYears(list);
      if (!academicYearId && list[0]) setAcademicYearId(list[0].id);
    })();
  }, [open, academicYearId]);

  function reset() {
    setFile(null);
    setRows(null);
    setSummary(null);
    setUnmapped([]);
    setMappings({});
    if (fileRef.current) fileRef.current.value = "";
  }

  async function runImport(dryRun: boolean) {
    if (!file || !academicYearId) return;
    if (!dryRun && (unmapped.length > 0 || (summary?.error_rows ?? 0) > 0)) {
      toast.error("Resolve all unmapped classes and errors before importing.");
      return;
    }
    const supabase = createClient();
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session) {
      toast.error("Not authenticated. Please log in again.");
      return;
    }
    (dryRun ? setPreviewing : setCommitting)(true);
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("academic_year_id", academicYearId);
      form.append("dry_run", dryRun ? "true" : "false");
      if (Object.keys(mappings).length > 0) {
        form.append("class_mappings", JSON.stringify(mappings));
      }
      const res = await fetch("/api/fees/historical-import", {
        method: "POST",
        headers: { Authorization: `Bearer ${session.access_token}` },
        body: form,
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? "Import failed");
        return;
      }
      setRows(data.rows ?? []);
      setSummary(data.summary ?? null);
      setUnmapped(data.unmapped_classes ?? []);
      if (!dryRun && typeof data.summary?.committed === "number" && data.summary.committed > 0) {
        toast.success(
          `Imported ${data.summary.committed} payment${data.summary.committed === 1 ? "" : "s"}. Batch: ${data.summary.batch_id?.slice(0, 8)}…`
        );
        onImported?.();
      }
    } catch {
      toast.error("Network error. Please try again.");
    } finally {
      (dryRun ? setPreviewing : setCommitting)(false);
    }
  }

  const canCommit = useMemo(() => {
    if (!rows || !summary) return false;
    if (summary.error_rows > 0) return false;
    if (unmapped.length > 0) return false;
    if ((summary.payments_to_create ?? 0) === 0) return false;
    return true;
  }, [rows, summary, unmapped]);

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
        <History className="h-4 w-4 mr-2" />
        {triggerLabel}
      </DialogTrigger>
      <DialogContent className="sm:max-w-4xl max-h-[88vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Import historical fee payments</DialogTitle>
          <DialogDescription>
            Upload a &quot;Day Book (Account Wise) Report&quot; XLSX exported from the
            previous ERP software. Any missing classes, sections, and streams will be
            auto-created for the selected academic year. Imported payments are tagged{" "}
            <code>historical_unknown</code> and grouped under an auto-created
            &quot;Historical&quot; fee structure per class. Rows are fully editable
            afterwards.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <Label htmlFor="hf-year" className="text-xs">Academic year</Label>
              <select
                id="hf-year"
                value={academicYearId}
                onChange={(e) => setAcademicYearId(e.target.value)}
                className="mt-1 block w-full rounded-md border border-gray-200 dark:border-border bg-white dark:bg-background px-3 py-1.5 text-sm"
              >
                <option value="">— select —</option>
                {years.map((y) => (
                  <option key={y.id} value={y.id}>
                    {y.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <Label htmlFor="hf-file" className="text-xs">XLSX file</Label>
              <input
                id="hf-file"
                ref={fileRef}
                type="file"
                accept=".xlsx,.xls"
                onChange={(e) => {
                  const f = e.target.files?.[0] ?? null;
                  setFile(f);
                  setRows(null);
                  setSummary(null);
                  setUnmapped([]);
                }}
                className="mt-1 block w-full text-sm text-gray-500 dark:text-gray-400 file:mr-2 file:rounded-md file:border-0 file:bg-navy-900 file:px-3 file:py-1.5 file:text-xs file:text-white hover:file:bg-navy-900/90"
              />
            </div>
          </div>

          {file && (
            <div className="flex items-center justify-between gap-2 rounded-lg border border-gray-200 dark:border-border p-3">
              <div className="min-w-0">
                <p className="text-sm font-medium text-navy-900 dark:text-white truncate">
                  {file.name}
                </p>
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  {(file.size / 1024).toFixed(1)} KB
                </p>
              </div>
              <Button
                type="button"
                size="sm"
                onClick={() => runImport(true)}
                disabled={previewing || committing || !academicYearId}
                className="bg-navy-900 text-white hover:bg-navy-900/90"
              >
                {previewing ? (
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                ) : null}
                Preview
              </Button>
            </div>
          )}

          {unmapped.length > 0 && (
            <div className="rounded-lg border border-amber-200 dark:border-amber-900/40 bg-amber-50 dark:bg-amber-950/20 p-3 space-y-2">
              <p className="text-sm font-medium text-amber-900 dark:text-amber-300 flex items-center gap-1">
                <AlertTriangle className="h-4 w-4" />
                {unmapped.length} class name{unmapped.length === 1 ? "" : "s"} need mapping
              </p>
              <p className="text-xs text-amber-700 dark:text-amber-400">
                The previous software uses class names that don&apos;t match the ERP&apos;s
                Roman-numeral scheme. Pick the equivalent for each below, then click Preview again.
              </p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                {unmapped.map((rawName) => (
                  <div
                    key={rawName}
                    className="flex items-center gap-2 rounded-md border border-amber-200 dark:border-amber-900/40 bg-white dark:bg-background p-2"
                  >
                    <code className="text-xs flex-1 truncate">{rawName}</code>
                    <select
                      value={mappings[rawName]?.class_name ?? ""}
                      onChange={(e) =>
                        setMappings((m) => ({
                          ...m,
                          [rawName]: {
                            class_name: e.target.value,
                            stream_name: m[rawName]?.stream_name ?? null,
                          },
                        }))
                      }
                      className="text-xs rounded border border-gray-200 dark:border-border bg-white dark:bg-background px-1.5 py-0.5"
                    >
                      <option value="">→ class</option>
                      {ROMAN_CLASSES.map((c) => (
                        <option key={c} value={c}>
                          {c}
                        </option>
                      ))}
                    </select>
                    <select
                      value={mappings[rawName]?.stream_name ?? ""}
                      onChange={(e) =>
                        setMappings((m) => ({
                          ...m,
                          [rawName]: {
                            class_name: m[rawName]?.class_name ?? "",
                            stream_name:
                              e.target.value === ""
                                ? null
                                : (e.target.value as ClassMappingValue["stream_name"]),
                          },
                        }))
                      }
                      className="text-xs rounded border border-gray-200 dark:border-border bg-white dark:bg-background px-1.5 py-0.5"
                    >
                      {STREAMS.map((s) => (
                        <option key={s} value={s}>
                          {s || "no stream"}
                        </option>
                      ))}
                    </select>
                  </div>
                ))}
              </div>
              <div className="flex justify-end">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => runImport(true)}
                  disabled={previewing || Object.keys(mappings).length === 0}
                >
                  Re-preview with mappings
                </Button>
              </div>
            </div>
          )}

          {summary && (
            <div className="rounded-lg border border-gray-200 dark:border-border p-3 space-y-2">
              <div className="flex items-center flex-wrap gap-2 text-sm">
                <Badge variant="outline">Total {summary.total_rows} rows</Badge>
                <Badge variant="outline" className="bg-green-50 dark:bg-green-950/30 text-green-700 dark:text-green-400 border-green-200 dark:border-green-800">
                  Will apply {summary.payments_to_create} payments
                </Badge>
                {summary.error_rows > 0 && (
                  <Badge variant="outline" className="bg-red-50 dark:bg-red-950/30 text-red-700 dark:text-red-400 border-red-200 dark:border-red-800">
                    {summary.error_rows} error{summary.error_rows === 1 ? "" : "s"}
                  </Badge>
                )}
                {typeof summary.committed === "number" && summary.committed > 0 && (
                  <Badge variant="outline" className="bg-blue-50 dark:bg-blue-950/30 text-blue-700 dark:text-blue-400 border-blue-200 dark:border-blue-800">
                    Committed {summary.committed}
                  </Badge>
                )}
                {(summary.skipped_conflicts ?? 0) > 0 && (
                  <Badge variant="outline" className="text-gray-500">
                    Skipped duplicates {summary.skipped_conflicts}
                  </Badge>
                )}
              </div>
              {(summary.will_create_classes?.length ?? 0) > 0 && summary.dry_run && (
                <div className="text-xs text-gray-600 dark:text-gray-400 space-y-1">
                  <p className="font-medium">
                    {summary.will_create_streams?.length ? `${summary.will_create_streams.length} stream${summary.will_create_streams.length === 1 ? "" : "s"} and ` : ""}
                    {summary.will_create_classes!.length} class{summary.will_create_classes!.length === 1 ? "" : "es"} will be auto-created:
                  </p>
                  <div className="flex flex-wrap gap-1">
                    {summary.will_create_streams?.map((s) => (
                      <Badge key={`s-${s}`} variant="outline" className="text-amber-700 dark:text-amber-400 border-amber-300">
                        stream: {s}
                      </Badge>
                    ))}
                    {summary.will_create_classes!.map((c, i) => (
                      <Badge key={`c-${i}`} variant="outline">
                        {c.name}-{c.section}{c.stream_name ? ` (${c.stream_name})` : ""}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}
              {summary.batch_id && (
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  Batch ID: <code>{summary.batch_id}</code>
                </p>
              )}
              {summary.error_rows > 0 && (
                <p className="text-xs text-red-600 dark:text-red-400 flex items-start gap-1">
                  <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                  Resolve the errors below and re-preview. Nothing has been saved.
                </p>
              )}
              {typeof summary.committed === "number" && summary.committed > 0 && (
                <p className="text-xs text-blue-600 dark:text-blue-400 flex items-start gap-1">
                  <CheckCircle2 className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                  Import complete. You can close this dialog.
                </p>
              )}
            </div>
          )}

          {rows && rows.length > 0 && (
            <div className="max-h-[360px] overflow-auto rounded-lg border border-gray-200 dark:border-border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-12">#</TableHead>
                    <TableHead>SR / Class</TableHead>
                    <TableHead>Student</TableHead>
                    <TableHead className="text-right">Pmts</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r) => (
                    <TableRow
                      key={r.source_row}
                      className={r.ok ? "" : "bg-red-50/60 dark:bg-red-950/10"}
                    >
                      <TableCell className="text-xs text-gray-400">{r.source_row}</TableCell>
                      <TableCell className="text-xs">
                        {r.admission_no ? <code>{r.admission_no}</code> : <span className="text-gray-400">no SR</span>}{" "}
                        <span className="text-gray-500">{r.raw_class}-{r.raw_section}</span>
                      </TableCell>
                      <TableCell className="text-xs">{r.student_name || "—"}</TableCell>
                      <TableCell className="text-xs text-right">{r.payments_count}</TableCell>
                      <TableCell className="text-xs text-right">{r.total}</TableCell>
                      <TableCell className="text-xs">
                        {r.ok ? (
                          <span className="text-green-600 dark:text-green-400">
                            OK{r.matched_by === "name_fallback" ? " (by name)" : ""}
                          </span>
                        ) : (
                          <span className="text-red-600 dark:text-red-400">
                            {r.error}
                          </span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </div>

        <DialogFooter>
          <DialogClose render={<Button type="button" variant="outline" />}>
            Close
          </DialogClose>
          <Button
            type="button"
            onClick={() => runImport(false)}
            disabled={!canCommit || committing}
            className="bg-navy-900 text-white hover:bg-navy-900/90"
          >
            {committing ? (
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
            ) : (
              <Upload className="h-4 w-4 mr-2" />
            )}
            Import {summary?.payments_to_create ?? 0} payments
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
