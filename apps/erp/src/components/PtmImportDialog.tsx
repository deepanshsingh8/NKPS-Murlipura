"use client";

import { useRef, useState } from "react";
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
} from "lucide-react";
import { toast } from "sonner";

interface RowResult {
  index: number;
  admission_no: string;
  roll_number: string | number | "";
  student_name: string;
  meeting_date: string;
  attendance: string;
  ok: boolean;
  error?: string;
}

interface ImportSummary {
  total: number;
  to_apply: number;
  errors: number;
  committed: number;
  dry_run: boolean;
}

interface PtmImportDialogProps {
  classId: string | undefined;
  examTypeId?: string;
  disabled?: boolean;
  triggerLabel?: string;
  onImported?: () => void;
}

export function PtmImportDialog({
  classId,
  examTypeId,
  disabled,
  triggerLabel = "Import CSV",
  onImported,
}: PtmImportDialogProps) {
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [rows, setRows] = useState<RowResult[] | null>(null);
  const [summary, setSummary] = useState<ImportSummary | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const reset = () => {
    setFile(null);
    setRows(null);
    setSummary(null);
    if (fileRef.current) fileRef.current.value = "";
  };

  async function runImport(dryRun: boolean) {
    if (!file || !classId) return;
    const setter = dryRun ? setPreviewing : setCommitting;
    setter(true);
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("class_id", classId);
      if (examTypeId) form.append("exam_type_id", examTypeId);
      form.append("dry_run", dryRun ? "true" : "false");
      const res = await fetch("/api/ptm-notes/import", {
        method: "POST",
        body: form,
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? "Import failed");
        return;
      }
      setRows(data.rows ?? []);
      setSummary(data.summary ?? null);
      if (!dryRun && data.summary?.committed > 0) {
        toast.success(`Imported ${data.summary.committed} rows`);
        onImported?.();
      }
    } catch {
      toast.error("Network error. Please try again.");
    } finally {
      setter(false);
    }
  }

  const hasErrors = (summary?.errors ?? 0) > 0;
  const canCommit = rows !== null && !hasErrors && (summary?.to_apply ?? 0) > 0;
  const disabledAll = !classId || disabled;

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) reset();
      }}
    >
      <DialogTrigger
        render={
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={disabledAll}
          />
        }
      >
        <Upload className="h-4 w-4 mr-2" />
        {triggerLabel}
      </DialogTrigger>
      <DialogContent className="sm:max-w-3xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Import PTM notes from CSV</DialogTitle>
          <DialogDescription>
            Required columns: <code>admission_no</code> or <code>roll_number</code>,{" "}
            <code>meeting_date</code> (YYYY-MM-DD), <code>attendance</code>{" "}
            (present / absent). Optional: <code>teacher_remarks</code>,{" "}
            <code>parent_remarks</code>, <code>action_points</code>.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="flex items-center justify-end gap-2 flex-wrap">
            <div className="flex items-center gap-2">
              <input
                ref={fileRef}
                type="file"
                accept=".csv,.xlsx,.xls,text/csv"
                onChange={(e) => {
                  const f = e.target.files?.[0] ?? null;
                  setFile(f);
                  setRows(null);
                  setSummary(null);
                }}
                className="text-sm text-gray-500 dark:text-gray-400 file:mr-2 file:rounded-md file:border-0 file:bg-navy-900 file:px-3 file:py-1.5 file:text-xs file:text-white hover:file:bg-navy-900/90"
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
                disabled={previewing || committing}
                className="bg-navy-900 text-white hover:bg-navy-900/90"
              >
                {previewing ? (
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                ) : null}
                Preview
              </Button>
            </div>
          )}

          {summary && (
            <div className="rounded-lg border border-gray-200 dark:border-border p-3 space-y-2">
              <div className="flex items-center flex-wrap gap-2 text-sm">
                <Badge variant="outline">Total {summary.total}</Badge>
                <Badge
                  variant="outline"
                  className="bg-green-50 dark:bg-green-950/30 text-green-700 dark:text-green-400 border-green-200 dark:border-green-800"
                >
                  Will apply {summary.to_apply}
                </Badge>
                {summary.errors > 0 && (
                  <Badge
                    variant="outline"
                    className="bg-red-50 dark:bg-red-950/30 text-red-700 dark:text-red-400 border-red-200 dark:border-red-800"
                  >
                    {summary.errors} error{summary.errors === 1 ? "" : "s"}
                  </Badge>
                )}
                {summary.committed > 0 && (
                  <Badge
                    variant="outline"
                    className="bg-blue-50 dark:bg-blue-950/30 text-blue-700 dark:text-blue-400 border-blue-200 dark:border-blue-800"
                  >
                    Committed {summary.committed}
                  </Badge>
                )}
              </div>
              {summary.errors > 0 && (
                <p className="text-xs text-red-600 dark:text-red-400 flex items-start gap-1">
                  <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                  Fix the errors below and re-upload. Nothing has been saved.
                </p>
              )}
              {summary.committed > 0 && (
                <p className="text-xs text-blue-600 dark:text-blue-400 flex items-start gap-1">
                  <CheckCircle2 className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                  Notes saved. You can close this dialog.
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
                    <TableHead>Admission</TableHead>
                    <TableHead>Roll</TableHead>
                    <TableHead>Student</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead>Attendance</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r) => (
                    <TableRow
                      key={r.index}
                      className={r.ok ? "" : "bg-red-50/60 dark:bg-red-950/10"}
                    >
                      <TableCell className="text-xs text-gray-400 dark:text-gray-500">
                        {r.index}
                      </TableCell>
                      <TableCell className="text-xs">
                        {r.admission_no || "—"}
                      </TableCell>
                      <TableCell className="text-xs">
                        {r.roll_number === "" ? "—" : r.roll_number}
                      </TableCell>
                      <TableCell className="text-xs">
                        {r.student_name || "—"}
                      </TableCell>
                      <TableCell className="text-xs">
                        {r.meeting_date || "—"}
                      </TableCell>
                      <TableCell className="text-xs">
                        {r.attendance || "—"}
                      </TableCell>
                      <TableCell className="text-xs">
                        {r.ok ? (
                          <span className="text-green-600 dark:text-green-400">
                            OK
                          </span>
                        ) : (
                          <span className="text-red-600 dark:text-red-400">
                            {r.error ?? "error"}
                          </span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}

          {rows && rows.length === 0 && (
            <p className="text-sm text-gray-500 dark:text-gray-400 text-center py-4">
              The uploaded file has no rows.
            </p>
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
            Apply import
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
