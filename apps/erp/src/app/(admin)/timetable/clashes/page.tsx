"use client";

/**
 * Clash Check — the audit screen for migration 119's shared-activity exemption.
 *
 * Relaxing the teacher double-booking constraint was only defensible because
 * what it stopped blocking stays visible. `timetable_teacher_clashes` has done
 * that since 119, but only to someone with a SQL prompt. This is that view with
 * a door on it.
 *
 * The view returns one row per overlapping PAIR, which is the wrong shape to
 * read directly: a coach shared across four sections is C(4,2) = 6 rows, and a
 * Games period across eight sections is 84 rows for that one period. So the
 * intentional ones are collapsed back into one line per (teacher, day, time)
 * and the screen opens on the handful that actually need attention.
 */

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { createClient } from "@nkps/shared/lib/supabase/client";
import {
  Table,
  TableBody,
  TableCell,
  TableHeader,
  TableRow,
} from "@nkps/shared/components/ui/table";
import {
  SortFilterHead,
  TableFilterSummary,
  useTableControls,
  type TableColumns,
} from "@nkps/shared/components/ui/data-table";
import { TableExportButton } from "@nkps/shared/components/ui/table-export-button";
import { toast } from "sonner";
import { Loader2, Info, ShieldCheck, TriangleAlert, Users } from "lucide-react";
import {
  accidentalClashes,
  sharedBookings,
  type ClashViewRow,
  type ClashProblem,
  type SharedBooking,
} from "@/lib/timetable-clashes";

const DAY_LABELS: Record<number, string> = {
  1: "Monday",
  2: "Tuesday",
  3: "Wednesday",
  4: "Thursday",
  5: "Friday",
  6: "Saturday",
};

function hhmm(t: string): string {
  return t && t.length >= 5 ? t.slice(0, 5) : t;
}

export default function TimetableClashesPage() {
  const [rows, setRows] = useState<ClashViewRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<"problems" | "shared">("problems");

  useEffect(() => {
    const fetchData = async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("timetable_teacher_clashes")
        .select("*")
        .order("day_of_week")
        .order("a_start");
      if (error) {
        toast.error("Failed to load the clash report");
        setLoading(false);
        return;
      }
      setRows((data ?? []) as ClashViewRow[]);
      setLoading(false);
    };
    fetchData();
  }, []);

  // Neither side marked shared — nobody chose this, so it is a bug. The
  // constraint refuses these on the normal path, so anything here arrived
  // before 119 or through a service-role write that bypassed it.
  const problems = useMemo(() => accidentalClashes(rows), [rows]);
  const shared = useMemo(() => sharedBookings(rows), [rows]);

  const problemColumns = useMemo<TableColumns<ClashProblem>>(
    () => ({
      teacher: { label: "Teacher", value: (r) => r.teacher_name, filter: "text" },
      day: {
        label: "Day",
        value: (r) => DAY_LABELS[r.day_of_week] ?? String(r.day_of_week),
        filter: "select",
        sortValue: (r) => r.day_of_week,
      },
      first: { label: "Booked for", value: (r) => `${r.class_a} · ${r.a_time}` },
      second: { label: "…and also", value: (r) => `${r.class_b} · ${r.b_time}` },
    }),
    []
  );

  const sharedColumns = useMemo<TableColumns<SharedBooking>>(
    () => ({
      teacher: { label: "Teacher", value: (r) => r.teacher_name, filter: "text" },
      day: {
        label: "Day",
        value: (r) => DAY_LABELS[r.day_of_week] ?? String(r.day_of_week),
        filter: "select",
        sortValue: (r) => r.day_of_week,
      },
      time: {
        label: "Time",
        value: (r) => `${hhmm(r.start_time)}–${hhmm(r.end_time)}`,
        sortValue: (r) => r.start_time,
      },
      classes: {
        label: "Classes together",
        value: (r) => r.classes.join(", "),
        filter: "none",
      },
      count: {
        label: "How many",
        value: (r) => r.classes.length,
        filter: "none",
      },
    }),
    []
  );

  const problemTable = useTableControls({ rows: problems, columns: problemColumns });
  const sharedTable = useTableControls({ rows: shared, columns: sharedColumns });

  return (
    <div>
      <div className="mb-6">
        <h1 className="font-heading text-2xl font-bold text-navy-900 dark:text-white">
          Clash Check
        </h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
          Every teacher who is in two places at once, and whether anyone meant it.
        </p>
      </div>

      <div className="mb-4 flex items-start gap-3 rounded-lg border border-blue-200 bg-blue-50 p-3 dark:border-blue-900/40 dark:bg-blue-950/20">
        <Info className="mt-0.5 h-4 w-4 flex-shrink-0 text-blue-600 dark:text-blue-400" />
        <p className="text-xs text-blue-800 dark:text-blue-300">
          A teacher normally cannot be booked for two overlapping periods — the
          database refuses it. Ticking{" "}
          <span className="font-medium">Shared activity</span> on a period is the
          only way past that, and it is meant for a games period where one coach
          takes several sections together. This page lists what that tick has
          allowed, so an accidental double-booking cannot hide among the
          deliberate ones. Fix one on the{" "}
          <Link
            href="/timetable"
            className="font-medium underline underline-offset-2 hover:text-blue-900 dark:hover:text-blue-200"
          >
            Class Timetable
          </Link>
          .
        </p>
      </div>

      <div className="mb-4 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => setView("problems")}
          className={`inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm transition-colors ${
            view === "problems"
              ? "border-red-300 bg-red-50 text-red-800 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-300"
              : "border-gray-200 text-gray-600 hover:bg-gray-50 dark:border-border dark:text-gray-300 dark:hover:bg-muted"
          }`}
        >
          <TriangleAlert className="h-4 w-4" />
          Needs attention
          <span className="ml-1 rounded bg-white/70 px-1.5 text-xs dark:bg-black/30">
            {problems.length}
          </span>
        </button>
        <button
          type="button"
          onClick={() => setView("shared")}
          className={`inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm transition-colors ${
            view === "shared"
              ? "border-cyan-300 bg-cyan-50 text-cyan-800 dark:border-cyan-900/50 dark:bg-cyan-950/30 dark:text-cyan-300" // color-ok: cyan is the Timetable module accent, matching its hub tile
              : "border-gray-200 text-gray-600 hover:bg-gray-50 dark:border-border dark:text-gray-300 dark:hover:bg-muted"
          }`}
        >
          <Users className="h-4 w-4" />
          Shared activities
          <span className="ml-1 rounded bg-white/70 px-1.5 text-xs dark:bg-black/30">
            {shared.length}
          </span>
        </button>
      </div>

      <div className="erp-table-container p-4 sm:p-6">
        {loading ? (
          <div className="flex justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-gray-400 dark:text-gray-500" />
          </div>
        ) : view === "problems" ? (
          problems.length === 0 ? (
            // The healthy state, and the message the screen mostly exists to
            // deliver.
            <div className="py-12 text-center">
              <ShieldCheck className="mx-auto mb-3 h-10 w-10 text-green-600 dark:text-green-500" />
              <p className="text-sm font-medium text-navy-900 dark:text-white">
                No accidental double-bookings.
              </p>
              <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                Every overlap in the timetable is a shared activity somebody
                ticked on purpose.
              </p>
            </div>
          ) : (
            <>
              <div className="mb-3 flex flex-wrap items-center justify-end gap-2">
                <TableFilterSummary
                  ctl={problemTable}
                  total={problems.length}
                  shown={problemTable.rows.length}
                  className="mb-0 mr-auto"
                />
                <TableExportButton
                  ctl={problemTable}
                  filename="timetable-clashes"
                  title="Timetable clashes needing attention"
                  featureKey="timetable"
                />
              </div>
              <Table>
                <TableHeader>
                  <TableRow>
                    <SortFilterHead ctl={problemTable} col="teacher" />
                    <SortFilterHead ctl={problemTable} col="day" />
                    <SortFilterHead ctl={problemTable} col="first" />
                    <SortFilterHead ctl={problemTable} col="second" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {problemTable.rows.length === 0 && (
                    <TableRow>
                      <TableCell
                        colSpan={4}
                        className="py-10 text-center text-gray-500 dark:text-gray-400"
                      >
                        No clashes match the column filters.
                      </TableCell>
                    </TableRow>
                  )}
                  {problemTable.rows.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell className="font-medium">{r.teacher_name}</TableCell>
                      <TableCell className="text-gray-600 dark:text-gray-300">
                        {DAY_LABELS[r.day_of_week] ?? r.day_of_week}
                      </TableCell>
                      <TableCell className="text-gray-600 dark:text-gray-300">
                        {r.class_a}
                        <span className="ml-1 text-gray-400 dark:text-gray-500">
                          {r.a_time}
                        </span>
                      </TableCell>
                      <TableCell className="text-gray-600 dark:text-gray-300">
                        {r.class_b}
                        <span className="ml-1 text-gray-400 dark:text-gray-500">
                          {r.b_time}
                        </span>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </>
          )
        ) : shared.length === 0 ? (
          <p className="py-12 text-center text-gray-500 dark:text-gray-400">
            No shared activities yet. Tick &ldquo;Shared activity&rdquo; on a
            period when one teacher takes several classes together.
          </p>
        ) : (
          <>
            <div className="mb-3 flex flex-wrap items-center justify-end gap-2">
              <TableFilterSummary
                ctl={sharedTable}
                total={shared.length}
                shown={sharedTable.rows.length}
                className="mb-0 mr-auto"
              />
              <TableExportButton
                ctl={sharedTable}
                filename="shared-activities"
                title="Shared activities"
                featureKey="timetable"
              />
            </div>
            <Table>
              <TableHeader>
                <TableRow>
                  <SortFilterHead ctl={sharedTable} col="teacher" />
                  <SortFilterHead ctl={sharedTable} col="day" />
                  <SortFilterHead ctl={sharedTable} col="time" />
                  <SortFilterHead ctl={sharedTable} col="classes" />
                  <SortFilterHead ctl={sharedTable} col="count" align="right" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {sharedTable.rows.length === 0 && (
                  <TableRow>
                    <TableCell
                      colSpan={5}
                      className="py-10 text-center text-gray-500 dark:text-gray-400"
                    >
                      No shared activities match the column filters.
                    </TableCell>
                  </TableRow>
                )}
                {sharedTable.rows.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-medium">{r.teacher_name}</TableCell>
                    <TableCell className="text-gray-600 dark:text-gray-300">
                      {DAY_LABELS[r.day_of_week] ?? r.day_of_week}
                    </TableCell>
                    <TableCell className="text-gray-600 dark:text-gray-300 font-mono text-xs">
                      {hhmm(r.start_time)}–{hhmm(r.end_time)}
                    </TableCell>
                    <TableCell className="text-gray-600 dark:text-gray-300">
                      {r.classes.join(", ")}
                    </TableCell>
                    <TableCell className="text-right text-gray-600 dark:text-gray-300">
                      {r.classes.length}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </>
        )}
      </div>
    </div>
  );
}
