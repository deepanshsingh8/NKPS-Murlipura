"use client";

import { Badge } from "@nkps/shared/components/ui/badge";
import { Card, CardContent } from "@nkps/shared/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@nkps/shared/components/ui/table";
import { AlertTriangle, CalendarDays } from "lucide-react";
import type { HistoryYear, HistoryGap } from "@/lib/student-history";

const STATUS_STYLES: Record<string, string> = {
  active:
    "bg-green-50 text-green-700 dark:bg-green-950/30 dark:text-green-400",
  passed: "bg-blue-50 text-blue-700 dark:bg-blue-950/30 dark:text-blue-400",
  failed: "bg-amber-50 text-amber-700 dark:bg-amber-950/30 dark:text-amber-400",
  // Gray, not red, and not the same as terminated. A student who left is a
  // neutral end state; a terminated enrolment is not, and the two rendered
  // identically here. The students table already paints exited gray, so
  // this screen and that one disagreed about the same status.
  exited:
    "bg-gray-100 text-gray-600 dark:bg-muted dark:text-gray-300",
  terminated: "bg-red-50 text-red-700 dark:bg-red-950/30 dark:text-red-400",
};

const inr = (n: number) =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(n);

const shortDate = (d: string | null) =>
  d
    ? new Date(d).toLocaleDateString("en-IN", {
        day: "2-digit",
        month: "short",
        year: "numeric",
      })
    : "—";

function titleCase(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function AcademicHistoryTimeline({
  years,
  gaps,
}: {
  years: HistoryYear[];
  gaps: HistoryGap[];
}) {
  if (years.length === 0) {
    return (
      <Card>
        <CardContent className="py-12 text-center">
          <CalendarDays className="h-10 w-10 mx-auto text-gray-300 dark:text-gray-600 mb-3" />
          <p className="text-gray-500 dark:text-gray-400">
            No academic history recorded yet.
          </p>
          <p className="text-sm text-gray-400 dark:text-gray-500 mt-1">
            History accumulates as sessions are promoted, and past sessions can
            be backfilled from the student bulk upload.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {gaps.length > 0 && (
        <div className="rounded-lg border border-amber-200 dark:border-amber-900/50 bg-amber-50 dark:bg-amber-950/20 p-3">
          <p className="flex items-center gap-2 text-sm font-medium text-amber-800 dark:text-amber-300">
            <AlertTriangle className="h-4 w-4" />
            {gaps.length} session{gaps.length === 1 ? "" : "s"} with records but
            no enrollment
          </p>
          <p className="mt-1 text-xs text-amber-700 dark:text-amber-400">
            {gaps.map((g) => g.year_name).join(", ")} — data was imported
            without an enrollment record, so report cards, mark sheets and roll
            numbers cannot see this student in that class. Re-run the import, or
            add the session from the bulk upload in backfill mode.
          </p>
        </div>
      )}

      {years.map((y) => {
        const e = y.enrollment;
        return (
          <Card key={y.academic_year.id}>
            <CardContent className="p-4 space-y-4">
              {/* ── Year header ── */}
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <h3 className="font-heading text-lg">{y.academic_year.name}</h3>
                  {y.academic_year.is_current && (
                    <Badge variant="secondary" className="text-[11px]">
                      Current
                    </Badge>
                  )}
                  {e && (
                    <Badge
                      variant="secondary"
                      className={STATUS_STYLES[e.status] ?? ""}
                    >
                      {titleCase(e.status)}
                    </Badge>
                  )}
                  {e && e.source !== "erp_native" && (
                    <Badge variant="outline" className="text-[11px]">
                      {e.source === "bulk_backfill" ? "Backfilled" : "Imported"}
                    </Badge>
                  )}
                </div>
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  {e ? (
                    <>
                      Class{" "}
                      <strong className="text-gray-700 dark:text-gray-200">
                        {e.class_name ?? "—"}
                        {e.class_section ? `-${e.class_section}` : ""}
                      </strong>
                      {e.stream_name ? ` · ${e.stream_name}` : ""}
                      {e.roll_number !== null ? ` · Roll ${e.roll_number}` : ""}
                    </>
                  ) : (
                    <span className="text-amber-600 dark:text-amber-400">
                      No enrollment record
                    </span>
                  )}
                </p>
              </div>

              {e?.status_reason && (
                <p className="text-xs text-gray-500 dark:text-gray-400 border-l-2 border-gray-200 dark:border-gray-700 pl-2">
                  {e.status_reason}
                  {e.status_changed_at && (
                    <span className="text-gray-400 dark:text-gray-500">
                      {" "}
                      — {shortDate(e.status_changed_at)}
                    </span>
                  )}
                </p>
              )}

              {/* ── Attendance / fees / marksheets summary ── */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
                <Stat
                  label="Attendance"
                  value={
                    y.attendance.percentage !== null
                      ? `${y.attendance.percentage}%`
                      : "—"
                  }
                  sub={
                    y.attendance.total_days > 0
                      ? `${y.attendance.present_days} / ${y.attendance.total_days} days`
                      : "Not marked"
                  }
                />
                <Stat
                  label="Fees paid"
                  value={y.fees.receipts > 0 ? inr(y.fees.paid) : "—"}
                  sub={
                    y.fees.receipts > 0
                      ? `${y.fees.receipts} receipt${y.fees.receipts === 1 ? "" : "s"}${y.fees.waived > 0 ? ` · ${inr(y.fees.waived)} waived` : ""}`
                      : "No payments"
                  }
                />
                <Stat
                  label="Exams recorded"
                  value={String(y.exams.length)}
                  sub={y.exams.length > 0 ? "See below" : "None"}
                />
                <Stat
                  label="Mark sheets"
                  value={String(y.marksheets.length)}
                  sub={
                    y.marksheets.some((m) => m.kind === "year_final")
                      ? "Year final published"
                      : y.marksheets.length > 0
                        ? "Per-exam only"
                        : "None published"
                  }
                />
              </div>

              {/* ── Exams ── */}
              {y.exams.length > 0 && (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Exam</TableHead>
                        <TableHead className="w-24">Subjects</TableHead>
                        <TableHead className="w-32">Marks</TableHead>
                        <TableHead className="w-20">%</TableHead>
                        <TableHead className="w-20">Grade</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {y.exams.map((ex) => (
                        <TableRow key={ex.exam_type_id}>
                          <TableCell className="font-medium">
                            {ex.name}
                            {!ex.is_published && (
                              <Badge
                                variant="outline"
                                className="ml-2 text-[10px]"
                              >
                                Unpublished
                              </Badge>
                            )}
                          </TableCell>
                          <TableCell className="text-sm text-gray-500 dark:text-gray-400">
                            {ex.subjects_counted}
                          </TableCell>
                          <TableCell className="text-sm">
                            {ex.total_obtained} / {ex.total_max}
                          </TableCell>
                          <TableCell className="text-sm">
                            {ex.percentage !== null ? `${ex.percentage}%` : "—"}
                          </TableCell>
                          <TableCell className="text-sm">
                            {ex.grade ?? "—"}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}

              {/* ── Status changes ── */}
              {y.status_events.length > 0 && (
                <div className="space-y-1">
                  <p className="text-xs font-medium text-gray-500 dark:text-gray-400">
                    Status changes
                  </p>
                  {y.status_events.map((ev, i) => (
                    <p
                      key={`${ev.changed_at}-${i}`}
                      className="text-xs text-gray-500 dark:text-gray-400"
                    >
                      <span className="text-gray-700 dark:text-gray-200">
                        {ev.from_status ? `${titleCase(ev.from_status)} → ` : ""}
                        {titleCase(ev.to_status)}
                      </span>
                      {ev.reason ? ` — ${ev.reason}` : ""}
                      <span className="text-gray-400 dark:text-gray-500">
                        {" "}
                        ({shortDate(ev.changed_at)})
                      </span>
                    </p>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

function Stat({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub: string;
}) {
  return (
    <div className="rounded-lg border border-gray-100 dark:border-border p-2.5">
      <p className="text-[11px] uppercase tracking-wide text-gray-400 dark:text-gray-500">
        {label}
      </p>
      <p className="text-base font-semibold text-gray-800 dark:text-gray-100">
        {value}
      </p>
      <p className="text-[11px] text-gray-500 dark:text-gray-400">{sub}</p>
    </div>
  );
}
