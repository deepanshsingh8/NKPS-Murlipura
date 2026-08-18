"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@nkps/shared/lib/supabase/client";
import { useUrlState } from "@nkps/shared/lib/hooks/use-url-state";
import { Button } from "@nkps/shared/components/ui/button";
import { Input } from "@nkps/shared/components/ui/input";
import { Label } from "@nkps/shared/components/ui/label";
import { Badge } from "@nkps/shared/components/ui/badge";
import { Checkbox } from "@nkps/shared/components/ui/checkbox";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@nkps/shared/components/ui/dialog";
import { Card, CardContent } from "@nkps/shared/components/ui/card";
import { toast } from "sonner";
import { Plus, Trash2, Loader2, Copy, AlarmClock, Eraser } from "lucide-react";
import { adminFetch } from "@nkps/shared/lib/admin-api";
import { compareScheduleRows } from "@/lib/fees";
import { FEE_HEADS } from "@nkps/shared/types";
import type { FeeStructure, FeeStudentType, Stream } from "@nkps/shared/types";

// Classes carrying their own fee schedule. The school publishes one schedule
// per class for Nursery–X and XII, and one per stream for XI — so XI alone is
// stream-scoped here. (The legacy single-row dialog in AdminFeesContent still
// offers an optional stream on XII as well; it predates the published
// schedule and stays as-is so existing XII stream rows remain editable.)
const CLASS_NAMES = [
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

const STREAM_CLASSES = ["XI"];

// How many times a year the old recurring model bills a row. Shown on legacy
// rows so it's obvious that a ₹8,750 "quarterly" row is really ₹35,000 a year
// — the mismatch the instalment schedule exists to remove.
const LEGACY_MULTIPLIER: Record<string, number> = {
  monthly: 12,
  quarterly: 4,
  annual: 1,
};

const STUDENT_TYPE_LABELS: Record<FeeStudentType, string> = {
  new: "New Student",
  existing: "Old Student",
  both: "Both",
};

// A row being edited. Every field is a string so a half-typed amount or a
// cleared date doesn't fight the controlled input; parsing happens on save.
// `id` is present only for rows already persisted — the save endpoint uses
// its absence to decide insert vs update.
interface DraftRow {
  key: string;
  id?: string;
  fee_type: string;
  due_date: string;
  instalment_name: string;
  amount: string;
  student_type: FeeStudentType;
  month_label: string;
  late_fee_start_date: string;
  late_fee_percent: string;
  late_fee_per_day: string;
  late_fee_max: string;
  // Carried through untouched for legacy rows created before the schedule
  // grid existed (a 'monthly' tuition row, say). Saving converts them to
  // one_time instalments, so the badge warns before that happens.
  legacy_frequency: string | null;
}

let draftCounter = 0;
const nextKey = () => `draft-${draftCounter++}`;

function toDraft(fs: FeeStructure): DraftRow {
  return {
    key: fs.id,
    id: fs.id,
    fee_type: fs.fee_type,
    due_date: fs.due_date ?? "",
    instalment_name: fs.instalment_name ?? "",
    amount: String(fs.amount ?? ""),
    student_type: fs.student_type ?? "both",
    month_label: fs.month_label ?? "",
    late_fee_start_date: fs.late_fee_start_date ?? "",
    late_fee_percent: fs.late_fee_percent ? String(fs.late_fee_percent) : "",
    late_fee_per_day: fs.late_fee_per_day ? String(fs.late_fee_per_day) : "",
    late_fee_max: fs.late_fee_max != null ? String(fs.late_fee_max) : "",
    legacy_frequency: fs.frequency !== "one_time" ? fs.frequency : null,
  };
}

function emptyDraft(previous?: DraftRow): DraftRow {
  return {
    key: nextKey(),
    // Adding a row usually means "another instalment of the same head", so
    // inherit the previous row's head and late-fee rule rather than resetting.
    fee_type: previous?.fee_type ?? FEE_HEADS[1],
    due_date: "",
    instalment_name: "",
    amount: previous?.amount ?? "",
    student_type: previous?.student_type ?? "both",
    month_label: "",
    late_fee_start_date: "",
    late_fee_percent: previous?.late_fee_percent ?? "",
    late_fee_per_day: previous?.late_fee_per_day ?? "",
    late_fee_max: previous?.late_fee_max ?? "",
    legacy_frequency: null,
  };
}

const inr = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 0,
});

// The fee schedule editor: one grid per (academic year, class, stream), laid
// out exactly like the schedule the school publishes — a row per instalment
// with its own due date, name, amount, audience and late-fee grace date.
export function FeeScheduleGrid() {
  const supabase = createClient();

  const [academicYearId, setAcademicYearId] = useState("");
  const [streams, setStreams] = useState<Stream[]>([]);
  // Selection lives in the URL so switching class then going back restores it.
  const [className, setClassName] = useUrlState("schedule_class");
  const [streamId, setStreamId] = useUrlState("schedule_stream");

  const [rows, setRows] = useState<DraftRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  // Late-fee rule editor. The published schedule has no column for the rate
  // (only the date it starts), so the per-day / percent / cap fields live in a
  // small dialog hung off each row rather than widening the grid.
  const [lateFeeRowKey, setLateFeeRowKey] = useState<string | null>(null);

  const [copyOpen, setCopyOpen] = useState(false);
  const [copyTargets, setCopyTargets] = useState<string[]>([]);
  const [copying, setCopying] = useState(false);

  const selectedClass = className || CLASS_NAMES[0];
  const supportsStream = STREAM_CLASSES.includes(selectedClass);
  const effectiveStreamId = supportsStream ? streamId || "" : "";

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [{ data: year }, { data: streamRows }] = await Promise.all([
        supabase
          .from("academic_years")
          .select("id")
          .eq("is_current", true)
          .maybeSingle(),
        supabase
          .from("streams")
          .select("*")
          .eq("is_active", true)
          .order("sort_order"),
      ]);
      if (cancelled) return;
      if (year?.id) setAcademicYearId(year.id as string);
      setStreams((streamRows as Stream[]) ?? []);
    })();
    return () => {
      cancelled = true;
    };
  }, [supabase]);

  const loadSchedule = useCallback(async () => {
    if (!academicYearId) return;
    setLoading(true);
    let query = supabase
      .from("fee_structures")
      .select("*")
      .eq("academic_year_id", academicYearId)
      .eq("class_name", selectedClass)
      .eq("is_active", true);
    query = effectiveStreamId
      ? query.eq("stream_id", effectiveStreamId)
      : query.is("stream_id", null);

    const { data, error } = await query;
    if (error) {
      toast.error("Failed to load the fee schedule");
      setLoading(false);
      return;
    }
    const loaded = ((data as FeeStructure[]) ?? [])
      .slice()
      .sort(compareScheduleRows)
      .map(toDraft);
    setRows(loaded);
    setDirty(false);
    setLoading(false);
  }, [supabase, academicYearId, selectedClass, effectiveStreamId]);

  useEffect(() => {
    loadSchedule();
  }, [loadSchedule]);

  const updateRow = (key: string, patch: Partial<DraftRow>) => {
    setRows((prev) =>
      prev.map((r) => (r.key === key ? { ...r, ...patch } : r))
    );
    setDirty(true);
  };

  const addRow = () => {
    setRows((prev) => [...prev, emptyDraft(prev[prev.length - 1])]);
    setDirty(true);
  };

  const removeRow = (key: string) => {
    setRows((prev) => prev.filter((r) => r.key !== key));
    setDirty(true);
  };

  const total = useMemo(
    () =>
      rows.reduce((sum, r) => {
        const amount = Number(r.amount);
        return Number.isFinite(amount) ? sum + amount : sum;
      }, 0),
    [rows]
  );

  // The annual bill differs per audience: a new student also pays the
  // admission fee, a returning one doesn't. Showing both totals is how the
  // office sanity-checks a schedule against the printed circular.
  const totalsByAudience = useMemo(() => {
    const sum = (types: FeeStudentType[]) =>
      rows.reduce((acc, r) => {
        if (!types.includes(r.student_type)) return acc;
        const amount = Number(r.amount);
        return Number.isFinite(amount) ? acc + amount : acc;
      }, 0);
    return {
      newStudent: sum(["new", "both"]),
      existingStudent: sum(["existing", "both"]),
    };
  }, [rows]);

  const legacyRowCount = useMemo(
    () => rows.filter((r) => r.legacy_frequency).length,
    [rows]
  );

  const lateFeeRow = rows.find((r) => r.key === lateFeeRowKey) ?? null;

  const handleSave = async () => {
    if (!academicYearId) {
      toast.error("No current academic year found");
      return;
    }
    if (supportsStream && !effectiveStreamId) {
      toast.error(
        `Class ${selectedClass} is billed per stream — pick a stream before saving.`
      );
      return;
    }

    // Validate client-side first so the admin gets a row number to fix rather
    // than a flattened Zod error naming an array index.
    const payloadRows = [];
    for (const [i, row] of rows.entries()) {
      const sNo = i + 1;
      if (!row.fee_type.trim()) {
        toast.error(`Row ${sNo}: pick a fee head`);
        return;
      }
      if (!row.due_date) {
        toast.error(`Row ${sNo}: a due date is required`);
        return;
      }
      const amount = Number(row.amount);
      if (!Number.isFinite(amount) || amount <= 0) {
        toast.error(`Row ${sNo}: enter an amount greater than 0`);
        return;
      }
      if (row.late_fee_start_date && row.late_fee_start_date < row.due_date) {
        toast.error(
          `Row ${sNo}: the late fee cannot start before the due date`
        );
        return;
      }
      const pct = row.late_fee_percent ? Number(row.late_fee_percent) : 0;
      if (!Number.isFinite(pct) || pct < 0 || pct > 100) {
        toast.error(`Row ${sNo}: late fee % must be between 0 and 100`);
        return;
      }
      const perDay = row.late_fee_per_day ? Number(row.late_fee_per_day) : 0;
      if (!Number.isFinite(perDay) || perDay < 0) {
        toast.error(`Row ${sNo}: late fee per day must be 0 or more`);
        return;
      }
      const max =
        row.late_fee_max.trim() === "" ? null : Number(row.late_fee_max);
      if (max !== null && (!Number.isFinite(max) || max < 0)) {
        toast.error(`Row ${sNo}: max late fee must be 0 or more`);
        return;
      }
      payloadRows.push({
        ...(row.id ? { id: row.id } : {}),
        fee_type: row.fee_type.trim(),
        due_date: row.due_date,
        instalment_name: row.instalment_name.trim(),
        amount,
        student_type: row.student_type,
        month_label: row.month_label.trim(),
        late_fee_start_date: row.late_fee_start_date || null,
        late_fee_percent: pct,
        late_fee_per_day: perDay,
        late_fee_max: max,
      });
    }

    setSaving(true);
    const res = await adminFetch("/api/fees/schedule", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        academic_year_id: academicYearId,
        class_name: selectedClass,
        stream_id: effectiveStreamId || null,
        rows: payloadRows,
      }),
    });
    const result = await res.json();
    setSaving(false);

    if (!res.ok) {
      toast.error(result.error ?? "Failed to save the fee schedule");
      return;
    }
    toast.success(
      result.deactivated > 0
        ? `Schedule saved. ${result.deactivated} already-billed row(s) were deactivated instead of deleted.`
        : "Fee schedule saved"
    );
    loadSchedule();
  };

  // Copy targets: every other class, plus one entry per stream for XI so a
  // Science schedule can be cloned to Commerce. Encoded as "class|streamId".
  const copyOptions = useMemo(() => {
    const options: { value: string; label: string }[] = [];
    for (const cn of CLASS_NAMES) {
      if (STREAM_CLASSES.includes(cn)) {
        for (const s of streams) {
          options.push({
            value: `${cn}|${s.id}`,
            label: `${cn} — ${s.name}`,
          });
        }
      } else {
        options.push({ value: `${cn}|`, label: cn });
      }
    }
    const self = `${selectedClass}|${effectiveStreamId}`;
    return options.filter((o) => o.value !== self);
  }, [streams, selectedClass, effectiveStreamId]);

  const handleCopy = async () => {
    if (copyTargets.length === 0) {
      toast.error("Pick at least one class to copy into");
      return;
    }
    setCopying(true);
    const res = await adminFetch("/api/fees/schedule/copy", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        academic_year_id: academicYearId,
        source_class_name: selectedClass,
        source_stream_id: effectiveStreamId || null,
        targets: copyTargets.map((t) => {
          const [cn, sid] = t.split("|");
          return { class_name: cn, stream_id: sid || null };
        }),
      }),
    });
    const result = await res.json();
    setCopying(false);
    if (!res.ok) {
      toast.error(result.error ?? "Failed to copy the schedule");
      return;
    }
    toast.success(
      `Copied ${result.rows} row(s) into ${result.classes} class(es).` +
        (result.deactivated > 0
          ? ` ${result.deactivated} already-billed row(s) were deactivated.`
          : "")
    );
    setCopyOpen(false);
    setCopyTargets([]);
  };

  const cellInput =
    "h-9 w-full rounded-md border border-gray-300 dark:border-border bg-white dark:bg-muted px-2 text-sm";

  return (
    <div>
      <Card className="bg-white dark:bg-card rounded-2xl shadow-sm mt-3">
        <CardContent>
          {/* Class / stream picker */}
          <div className="flex flex-wrap items-end justify-between gap-3 mb-5">
            <div className="flex flex-wrap items-end gap-3">
              <div>
                <Label className="mb-2 block text-xs font-medium">Class</Label>
                <select
                  value={selectedClass}
                  onChange={(e) => {
                    setClassName(e.target.value);
                    if (!STREAM_CLASSES.includes(e.target.value)) {
                      setStreamId("");
                    }
                  }}
                  className="rounded-md border border-gray-300 dark:border-border px-3 py-2 text-sm dark:bg-muted min-w-[160px]"
                >
                  {CLASS_NAMES.map((cn) => (
                    <option key={cn} value={cn}>
                      {cn}
                    </option>
                  ))}
                </select>
              </div>
              {supportsStream && (
                <div>
                  <Label className="mb-2 block text-xs font-medium">
                    Stream
                  </Label>
                  <select
                    value={effectiveStreamId}
                    onChange={(e) => setStreamId(e.target.value)}
                    className="rounded-md border border-gray-300 dark:border-border px-3 py-2 text-sm dark:bg-muted min-w-[180px]"
                  >
                    <option value="">Select a stream…</option>
                    {streams.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.code ? `${s.name} (${s.code})` : s.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>
            <div className="flex items-center gap-2">
              {/* Starting a class over shouldn't mean clicking the bin once
                  per row. Clearing is staged like any other edit — nothing
                  leaves the database until Save. */}
              <Button
                variant="outline"
                onClick={() => {
                  if (
                    !confirm(
                      `Clear all ${rows.length} row(s) for ${selectedClass}? Nothing is deleted until you press Save.`
                    )
                  )
                    return;
                  setRows([]);
                  setDirty(true);
                }}
                disabled={rows.length === 0 || loading}
              >
                <Eraser className="h-4 w-4 mr-2" />
                Clear all rows
              </Button>
              <Button
                variant="outline"
                onClick={() => setCopyOpen(true)}
                disabled={rows.length === 0 || dirty || loading}
                title={
                  dirty
                    ? "Save this schedule before copying it"
                    : "Copy this schedule to other classes"
                }
              >
                <Copy className="h-4 w-4 mr-2" />
                Copy to classes
              </Button>
            </div>
          </div>

          {supportsStream && !effectiveStreamId ? (
            <p className="text-center py-12 text-sm text-gray-500 dark:text-gray-400">
              Class {selectedClass} is billed per stream. Pick a stream above to
              edit its fee schedule.
            </p>
          ) : loading ? (
            <div className="flex justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-navy-900 dark:text-white" />
            </div>
          ) : (
            <>
              {/* Rows carried over from the old recurring model are billed N
                  times a year, which almost never matches a published
                  schedule. Say so plainly rather than leaving the admin to
                  work out why the totals look wrong. */}
              {legacyRowCount > 0 && (
                <div className="mb-4 rounded-lg border border-amber-300 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/30 px-3 py-2 text-xs text-amber-800 dark:text-amber-300">
                  {legacyRowCount} row(s) here were set up before this schedule
                  existed, as recurring fees. The totals below count each of
                  them once, but the system currently bills them by their
                  frequency (a quarterly row is charged 4× a year). Replace them
                  with one row per instalment and press Save to fix that.
                </div>
              )}
              <div className="overflow-x-auto">
                <table className="w-full min-w-[1100px] border-collapse text-sm">
                  <thead>
                    <tr className="text-left text-xs font-semibold text-gray-600 dark:text-gray-300">
                      <th className="px-2 py-2 w-14">S No</th>
                      <th className="px-2 py-2 w-44">Fee Head</th>
                      <th className="px-2 py-2 w-40">Due Date</th>
                      <th className="px-2 py-2 w-56">Instalment Name</th>
                      <th className="px-2 py-2 w-32">Amount</th>
                      <th className="px-2 py-2 w-36">Student Type</th>
                      <th className="px-2 py-2 w-36">Month Name</th>
                      <th className="px-2 py-2 w-40">Late Fee Start Date</th>
                      <th className="px-2 py-2 w-24 text-right">Late Fee</th>
                      <th className="px-2 py-2 w-12" />
                    </tr>
                  </thead>
                  <tbody>
                    {rows.length === 0 ? (
                      <tr>
                        <td
                          colSpan={10}
                          className="px-2 py-10 text-center text-gray-500 dark:text-gray-400"
                        >
                          No fee schedule set for {selectedClass}. Add rows
                          below, or copy one from another class.
                        </td>
                      </tr>
                    ) : (
                      rows.map((row, i) => (
                        <tr
                          key={row.key}
                          // Top-align every cell: a row carrying the legacy
                          // frequency badge is taller than its neighbours, and
                          // the default middle alignment then floats that
                          // row's other inputs out of line with the rest.
                          className="border-t border-gray-200 dark:border-border [&>td]:align-top"
                        >
                          <td className="px-2 py-2 text-gray-500 dark:text-gray-400 leading-9">
                            {i + 1}
                          </td>
                          <td className="px-2 py-2">
                            <select
                              value={row.fee_type}
                              onChange={(e) =>
                                updateRow(row.key, { fee_type: e.target.value })
                              }
                              className={cellInput}
                              aria-label={`Fee head for row ${i + 1}`}
                            >
                              {/* A legacy row may carry a head that predates
                                  this list — keep it selectable so saving
                                  doesn't silently relabel the fee. */}
                              {!FEE_HEADS.includes(
                                row.fee_type as (typeof FEE_HEADS)[number]
                              ) &&
                                row.fee_type && (
                                  <option value={row.fee_type}>
                                    {row.fee_type}
                                  </option>
                                )}
                              {FEE_HEADS.map((head) => (
                                <option key={head} value={head}>
                                  {head}
                                </option>
                              ))}
                            </select>
                          </td>
                          <td className="px-2 py-2">
                            <input
                              type="date"
                              value={row.due_date}
                              onChange={(e) =>
                                updateRow(row.key, { due_date: e.target.value })
                              }
                              className={cellInput}
                              aria-label={`Due date for row ${i + 1}`}
                            />
                          </td>
                          <td className="px-2 py-2">
                            <input
                              type="text"
                              value={row.instalment_name}
                              placeholder="1st Instalment (Tuition Fee)"
                              onChange={(e) =>
                                updateRow(row.key, {
                                  instalment_name: e.target.value,
                                })
                              }
                              className={cellInput}
                              aria-label={`Instalment name for row ${i + 1}`}
                            />
                          </td>
                          <td className="px-2 py-2">
                            <input
                              type="number"
                              min="0"
                              step="0.01"
                              value={row.amount}
                              onChange={(e) =>
                                updateRow(row.key, { amount: e.target.value })
                              }
                              className={cellInput}
                              aria-label={`Amount for row ${i + 1}`}
                            />
                            {row.legacy_frequency && (
                              <Badge
                                variant="secondary"
                                className="mt-1 text-[10px] whitespace-nowrap"
                                title={`This fee is currently stored as a ${row.legacy_frequency.replace(
                                  "_",
                                  " "
                                )} fee, so the system bills it ${
                                  LEGACY_MULTIPLIER[row.legacy_frequency] ?? 1
                                }× a year. Saving converts it to this single dated instalment.`}
                              >
                                × {LEGACY_MULTIPLIER[row.legacy_frequency] ?? 1}{" "}
                                {row.legacy_frequency.replace("_", " ")}
                              </Badge>
                            )}
                          </td>
                          <td className="px-2 py-2">
                            <select
                              value={row.student_type}
                              onChange={(e) =>
                                updateRow(row.key, {
                                  student_type: e.target
                                    .value as FeeStudentType,
                                })
                              }
                              className={cellInput}
                              aria-label={`Student type for row ${i + 1}`}
                            >
                              {(
                                Object.keys(
                                  STUDENT_TYPE_LABELS
                                ) as FeeStudentType[]
                              ).map((t) => (
                                <option key={t} value={t}>
                                  {STUDENT_TYPE_LABELS[t]}
                                </option>
                              ))}
                            </select>
                          </td>
                          <td className="px-2 py-2">
                            <input
                              type="text"
                              value={row.month_label}
                              placeholder="April, 2026"
                              onChange={(e) =>
                                updateRow(row.key, {
                                  month_label: e.target.value,
                                })
                              }
                              className={cellInput}
                              aria-label={`Month name for row ${i + 1}`}
                            />
                          </td>
                          <td className="px-2 py-2">
                            <input
                              type="date"
                              value={row.late_fee_start_date}
                              min={row.due_date || undefined}
                              onChange={(e) =>
                                updateRow(row.key, {
                                  late_fee_start_date: e.target.value,
                                })
                              }
                              className={cellInput}
                              aria-label={`Late fee start date for row ${i + 1}`}
                            />
                          </td>
                          {/* The action cells hold buttons shorter than the
                              h-9 inputs beside them, so each gets an h-9 box
                              that centres its control on the input's midline. */}
                          <td className="px-2 py-2">
                            <div className="flex h-9 items-center justify-end">
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-8 px-2 text-xs"
                                onClick={() => setLateFeeRowKey(row.key)}
                                title="Late fee rate for this instalment"
                              >
                                <AlarmClock className="h-3.5 w-3.5 mr-1" />
                                {row.late_fee_per_day
                                  ? `₹${row.late_fee_per_day}/day`
                                  : row.late_fee_percent
                                    ? `${row.late_fee_percent}%`
                                    : "Set"}
                              </Button>
                            </div>
                          </td>
                          <td className="px-2 py-2">
                            <div className="flex h-9 items-center justify-end">
                              <button
                                onClick={() => removeRow(row.key)}
                                className="rounded-md bg-gold-500 hover:bg-gold-600 text-white p-1.5"
                                aria-label={`Delete row ${i + 1}`}
                              >
                                <Trash2 className="h-4 w-4" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>

              <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                <Button variant="outline" onClick={addRow}>
                  <Plus className="h-4 w-4 mr-2" />
                  Add Row
                </Button>
                {rows.length > 0 && (
                  <div className="text-right text-xs text-gray-500 dark:text-gray-400">
                    <div>
                      New student total:{" "}
                      <span className="font-semibold text-navy-900 dark:text-white">
                        {inr.format(totalsByAudience.newStudent)}
                      </span>
                    </div>
                    <div>
                      Old student total:{" "}
                      <span className="font-semibold text-navy-900 dark:text-white">
                        {inr.format(totalsByAudience.existingStudent)}
                      </span>
                    </div>
                    <div className="mt-1 opacity-70">
                      {rows.length} row(s) · {inr.format(total)} listed
                    </div>
                  </div>
                )}
              </div>

              <div className="mt-6 border-t border-gray-200 dark:border-border pt-4">
                <Button
                  onClick={handleSave}
                  disabled={saving}
                  className="bg-blue-600 hover:bg-blue-700 text-white"
                >
                  {saving ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Saving…
                    </>
                  ) : (
                    "Save"
                  )}
                </Button>
                {dirty && (
                  <span className="ml-3 text-xs text-amber-600 dark:text-amber-400">
                    Unsaved changes
                  </span>
                )}
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* Late-fee rate for one instalment */}
      <Dialog
        open={lateFeeRow !== null}
        onOpenChange={(open) => !open && setLateFeeRowKey(null)}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Late fee rule</DialogTitle>
          </DialogHeader>
          {lateFeeRow && (
            <div className="space-y-4">
              <p className="text-xs text-gray-500 dark:text-gray-400">
                Charged from{" "}
                <span className="font-medium">
                  {lateFeeRow.late_fee_start_date ||
                    lateFeeRow.due_date ||
                    "the due date"}
                </span>
                . The higher of the two rates below applies, capped at the
                maximum when one is set.
              </p>
              <div>
                <Label className="mb-2 block text-xs">Per day (₹)</Label>
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  value={lateFeeRow.late_fee_per_day}
                  onChange={(e) =>
                    updateRow(lateFeeRow.key, {
                      late_fee_per_day: e.target.value,
                    })
                  }
                />
              </div>
              <div>
                <Label className="mb-2 block text-xs">
                  One-time surcharge (% of amount)
                </Label>
                <Input
                  type="number"
                  min="0"
                  max="100"
                  step="0.01"
                  value={lateFeeRow.late_fee_percent}
                  onChange={(e) =>
                    updateRow(lateFeeRow.key, {
                      late_fee_percent: e.target.value,
                    })
                  }
                />
              </div>
              <div>
                <Label className="mb-2 block text-xs">
                  Maximum late fee (₹) — blank for no cap
                </Label>
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  value={lateFeeRow.late_fee_max}
                  onChange={(e) =>
                    updateRow(lateFeeRow.key, { late_fee_max: e.target.value })
                  }
                />
              </div>
              <div className="flex justify-end">
                <Button onClick={() => setLateFeeRowKey(null)}>Done</Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Copy this schedule to other classes */}
      <Dialog open={copyOpen} onOpenChange={setCopyOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>
              Copy {selectedClass}&apos;s schedule to other classes
            </DialogTitle>
          </DialogHeader>
          <p className="text-xs text-gray-500 dark:text-gray-400">
            Each selected class&apos;s current schedule is replaced with a copy
            of this one. Rows that already have receipts against them are
            deactivated rather than deleted. Amounts can be edited per class
            afterwards.
          </p>
          <div className="max-h-72 overflow-y-auto rounded-md border border-gray-200 dark:border-border p-3 space-y-2">
            {copyOptions.map((opt) => (
              <label
                key={opt.value}
                className="flex items-center gap-2 text-sm cursor-pointer"
              >
                <Checkbox
                  checked={copyTargets.includes(opt.value)}
                  onCheckedChange={(checked) =>
                    setCopyTargets((prev) =>
                      checked
                        ? [...prev, opt.value]
                        : prev.filter((v) => v !== opt.value)
                    )
                  }
                />
                {opt.label}
              </label>
            ))}
          </div>
          <div className="flex justify-end gap-2">
            <DialogClose render={<Button type="button" variant="outline" />}>
              Cancel
            </DialogClose>
            <Button onClick={handleCopy} disabled={copying}>
              {copying ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Copying…
                </>
              ) : (
                `Copy to ${copyTargets.length} class(es)`
              )}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
