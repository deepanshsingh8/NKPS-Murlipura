"use client";

/**
 * §10 Timetable Excel Import.
 * Three steps:
 *  1. Download template + upload .xlsx
 *  2. Server returns a per-row preview with status (ok/warning/error)
 *  3. Admin confirms; commit endpoint either inserts everything or refuses (no partial commit)
 *
 * On error we offer a "Download error report" CSV the school can edit and re-upload.
 */

import { useState } from "react";
import Link from "next/link";
import { Button } from "@nkps/shared/components/ui/button";
import { ArrowLeft, Download, Upload, CheckCircle2, AlertTriangle, XCircle, Loader2 } from "lucide-react";
import { adminFetch } from "@nkps/shared/lib/admin-api";
import { toast } from "sonner";

interface PreviewRow {
  row_index: number;
  day: number | null;
  period: number | null;
  class_id: string | null;
  class_label: string;
  subject_id: string | null;
  subject_label: string;
  teacher_id: string | null;
  teacher_label: string;
  start_time: string | null;
  end_time: string | null;
  room: string | null;
  status: "ok" | "warning" | "error";
  messages: string[];
}

interface PreviewTotals {
  ok: number;
  warning: number;
  error: number;
}

const DAY_LABELS: Record<number, string> = {
  1: "Mon", 2: "Tue", 3: "Wed", 4: "Thu", 5: "Fri", 6: "Sat",
};

export default function TimetableImportPage() {
  const [file, setFile] = useState<File | null>(null);
  const [parsing, setParsing] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [preview, setPreview] = useState<PreviewRow[] | null>(null);
  const [totals, setTotals] = useState<PreviewTotals | null>(null);
  const [replaceExisting, setReplaceExisting] = useState(false);

  const handleParse = async () => {
    if (!file) { toast.error("Pick a file first"); return; }
    setParsing(true);
    setPreview(null);
    setTotals(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await adminFetch("/api/timetable/import", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || "Failed to parse file");
        return;
      }
      setPreview(data.rows);
      setTotals(data.totals);
    } finally {
      setParsing(false);
    }
  };

  const handleCommit = async () => {
    if (!preview) return;
    if (totals && totals.error > 0) {
      toast.error(`${totals.error} row(s) have errors. Fix them or remove from the file.`);
      return;
    }
    const okRows = preview.filter((r) => r.status !== "error" && r.class_id && r.subject_id);
    if (okRows.length === 0) {
      toast.error("Nothing to commit");
      return;
    }
    setCommitting(true);
    const res = await adminFetch("/api/timetable/import/commit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        rows: okRows.map((r) => ({
          class_id: r.class_id,
          subject_id: r.subject_id,
          teacher_id: r.teacher_id,
          day_of_week: r.day,
          period_number: r.period,
          start_time: r.start_time,
          end_time: r.end_time,
          room: r.room,
        })),
        replace: replaceExisting,
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      toast.error(data.error || "Commit failed");
    } else {
      toast.success(`Imported ${data.inserted} period(s)`);
      setPreview(null);
      setTotals(null);
      setFile(null);
    }
    setCommitting(false);
  };

  const downloadErrorReport = () => {
    if (!preview) return;
    const errored = preview.filter((r) => r.status === "error");
    if (errored.length === 0) {
      toast.info("No error rows to download");
      return;
    }
    const header = ["Row", "Day", "Period", "Section", "Subject", "Teacher", "Start", "End", "Room", "Errors"];
    const rows = errored.map((r) => [
      r.row_index,
      r.day != null ? DAY_LABELS[r.day] ?? r.day : "",
      r.period ?? "",
      r.class_label,
      r.subject_label,
      r.teacher_label,
      r.start_time ?? "",
      r.end_time ?? "",
      r.room ?? "",
      r.messages.join("; "),
    ]);
    const csv = [header, ...rows]
      .map((r) => r.map((cell) => {
        const s = String(cell ?? "");
        if (s.includes(",") || s.includes("\"") || s.includes("\n")) {
          return `"${s.replace(/"/g, '""')}"`;
        }
        return s;
      }).join(","))
      .join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `timetable-errors-${Date.now()}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6 p-6">
      <header>
        <Link href="/timetable" className="inline-flex items-center text-xs text-gray-500 hover:text-navy-900 mb-1">
          <ArrowLeft className="h-3.5 w-3.5 mr-1" /> Back to Timetable
        </Link>
        <h1 className="text-2xl font-bold text-navy-900 dark:text-white">Import Timetable from Excel</h1>
        <p className="text-sm text-gray-500 mt-1">
          Upload a .xlsx with columns Day, Period, Section, Subject, Teacher, Start, End, Room.
          We parse and preview every row; nothing is written until you click Commit.
        </p>
      </header>

      <div className="erp-table-container p-4 space-y-3">
        <div className="flex items-center gap-2 flex-wrap">
          <a
            href="/api/timetable/import/template"
            className="inline-flex items-center gap-1.5 rounded-md border border-gray-200 dark:border-border px-3 py-1.5 text-sm hover:bg-gray-50"
          >
            <Download className="h-4 w-4" /> Download template
          </a>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <input
            type="file"
            accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            className="text-sm"
          />
          <Button onClick={handleParse} disabled={!file || parsing} className="bg-navy-900 hover:bg-navy-800 text-white">
            {parsing && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
            <Upload className="h-4 w-4 mr-1.5" />
            Parse & Preview
          </Button>
        </div>
      </div>

      {totals && (
        <div className="erp-table-container p-4 space-y-3">
          <div className="flex flex-wrap gap-3 items-center">
            <span className="inline-flex items-center gap-1.5 text-sm">
              <CheckCircle2 className="h-4 w-4 text-green-600" /> {totals.ok} ready
            </span>
            <span className="inline-flex items-center gap-1.5 text-sm">
              <AlertTriangle className="h-4 w-4 text-amber-600" /> {totals.warning} warnings
            </span>
            <span className="inline-flex items-center gap-1.5 text-sm">
              <XCircle className="h-4 w-4 text-red-600" /> {totals.error} errors
            </span>
            {totals.error > 0 && (
              <Button variant="outline" size="sm" onClick={downloadErrorReport}>
                <Download className="h-4 w-4 mr-1" /> Download error report
              </Button>
            )}
            <label className="ml-auto flex items-center gap-2 text-sm cursor-pointer">
              <input type="checkbox" checked={replaceExisting} onChange={(e) => setReplaceExisting(e.target.checked)} className="rounded" />
              Overwrite existing periods at the same (class, day, period)
            </label>
            <Button
              onClick={handleCommit}
              disabled={committing || !preview || totals.error > 0}
              className="bg-navy-900 hover:bg-navy-800 text-white"
            >
              {committing && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
              Commit {totals.ok + totals.warning} row(s)
            </Button>
          </div>
        </div>
      )}

      {preview && preview.length > 0 && (
        <div className="erp-table-container overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-gray-50 dark:bg-muted">
              <tr>
                <th className="px-2 py-2 text-left">#</th>
                <th className="px-2 py-2 text-left">Status</th>
                <th className="px-2 py-2 text-left">Day</th>
                <th className="px-2 py-2 text-left">Period</th>
                <th className="px-2 py-2 text-left">Section</th>
                <th className="px-2 py-2 text-left">Subject</th>
                <th className="px-2 py-2 text-left">Teacher</th>
                <th className="px-2 py-2 text-left">Time</th>
                <th className="px-2 py-2 text-left">Room</th>
                <th className="px-2 py-2 text-left">Notes</th>
              </tr>
            </thead>
            <tbody>
              {preview.map((r) => (
                <tr
                  key={r.row_index}
                  className={`border-t border-gray-100 dark:border-border ${
                    r.status === "error" ? "bg-red-50/40" : r.status === "warning" ? "bg-amber-50/40" : ""
                  }`}
                >
                  <td className="px-2 py-1.5 font-mono">{r.row_index}</td>
                  <td className="px-2 py-1.5">
                    {r.status === "error" ? (
                      <XCircle className="h-3.5 w-3.5 text-red-600" />
                    ) : r.status === "warning" ? (
                      <AlertTriangle className="h-3.5 w-3.5 text-amber-600" />
                    ) : (
                      <CheckCircle2 className="h-3.5 w-3.5 text-green-600" />
                    )}
                  </td>
                  <td className="px-2 py-1.5">{r.day != null ? DAY_LABELS[r.day] ?? r.day : "—"}</td>
                  <td className="px-2 py-1.5">{r.period ?? "—"}</td>
                  <td className="px-2 py-1.5">{r.class_label}</td>
                  <td className="px-2 py-1.5">{r.subject_label}</td>
                  <td className="px-2 py-1.5">{r.teacher_label || <span className="text-gray-400">—</span>}</td>
                  <td className="px-2 py-1.5 font-mono">
                    {r.start_time && r.end_time ? `${r.start_time}–${r.end_time}` : <span className="text-gray-400">—</span>}
                  </td>
                  <td className="px-2 py-1.5">{r.room ?? <span className="text-gray-400">—</span>}</td>
                  <td className="px-2 py-1.5 text-[11px] text-gray-600">
                    {r.messages.join("; ") || <span className="text-gray-400">—</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
