// Reconstruct which instalment each historical receipt settled.
//
// The previous ERP software recorded money per fee HEAD ("Tuition Fee:
// 22,600") and never per instalment. Our schedule is a list of dated
// instalment rows (migration 085), and `fee_payments.fee_structure_id` points
// at one of them. Something has to bridge that, and this module is it: an
// oldest-due-first waterfall, per head, per student.
//
// ── Why bother, when the dues total would be right either way ───────────────
// computeDuesBreakdown() nets aggregates — `billedToDate - paid` — so the
// student's balance comes out correct however the money is attributed. One
// thing is NOT aggregate: the late-fee pass asks, per line, "is THIS line
// still owed?" (fees.ts). Park every rupee in one bucket and a student who
// paid instalment 1 on time but owes instalment 2 gets surcharged for both.
// Attribution also drives what the office and the parent actually see — the
// instalment grid reading "1st: Paid, 2nd: Pending" is the screen people work
// from.
//
// ── Why oldest-due-first ───────────────────────────────────────────────────
// It is what a fee counter does: money received clears the oldest outstanding
// demand. It is also the only rule that makes the late-fee pass agree with
// reality, because a payment made in April must settle April's instalment
// rather than January's.
//
// This is a reconstruction, not a record. Totals, dues and late fees come out
// right; the line attribution of any individual receipt is an inference.

import type { FeeStructure } from "@nkps/shared/types";
import { annualizedAmount, compareScheduleRows } from "./fees";

/** A schedule row this module can allocate against. */
export type AllocatableStructure = Pick<
  FeeStructure,
  | "id"
  | "fee_type"
  | "amount"
  | "frequency"
  | "due_date"
  | "instalment_no"
  | "instalment_name"
  | "month_label"
>;

export interface AllocatableHead {
  head: string;
  amount: number;
}

export interface AllocatableReceipt {
  /** Stable key back to the source row. */
  receipt_no: string;
  source_row: number;
  payment_date: string; // ISO
  heads: AllocatableHead[];
}

export interface AllocationSlice {
  receipt_no: string;
  source_row: number;
  /** 1-based index of this slice within its receipt, for the receipt number. */
  slice_no: number;
  head: string;
  fee_structure_id: string;
  instalment_name: string | null;
  month_label: string | null;
  amount: number;
  /** True when the slice does not fill the instalment it is attached to. */
  partial: boolean;
  /**
   * True when this slice is money beyond everything the schedule demands for
   * the head. Parked on the head's last instalment and surfaced in the
   * preview — the school may genuinely have collected more than it published,
   * and hiding that would be the worse error.
   */
  over_allocated: boolean;
}

export interface AllocationProblem {
  receipt_no: string;
  source_row: number;
  head: string;
  amount: number;
  message: string;
}

export interface AllocationResult {
  slices: AllocationSlice[];
  /** Heads that could not be placed at all. These block their row. */
  problems: AllocationProblem[];
}

/** Rupees → paise, so the waterfall never leaks a float remainder. */
function toPaise(n: number): number {
  return Math.round(Number(n) * 100);
}

function fromPaise(n: number): number {
  return n / 100;
}

/**
 * Group a class's schedule rows by fee head, each group in schedule order.
 *
 * Callers build TWO of these: the primary from the student's own effective
 * schedule (stream override + student-type rule, exactly as the dues math
 * resolves it), and a fallback from the same rows with the student-type rule
 * lifted. `allocateStudentReceipts` consults the fallback only for a head the
 * primary does not carry at all.
 *
 * That split matters. Ignoring student_type outright would be wrong for a
 * school that publishes separate new/returning rows for the same instalment —
 * a payment would fill one and spill into the other. Honouring it outright
 * would be wrong too: 209 students in the 2026-27 import paid an admission
 * fee, some of them returning students the schedule would not have billed, and
 * their receipts still have to land somewhere.
 */
export function groupScheduleByHead(
  structures: AllocatableStructure[]
): Map<string, AllocatableStructure[]> {
  const byHead = new Map<string, AllocatableStructure[]>();
  for (const s of structures) {
    const key = normalizeHead(s.fee_type);
    const arr = byHead.get(key) ?? [];
    arr.push(s);
    byHead.set(key, arr);
  }
  for (const arr of byHead.values()) arr.sort(compareScheduleRows);
  return byHead;
}

/** Case- and spacing-insensitive head key: "Tuition Fee" == "tuition  fee". */
export function normalizeHead(head: string): string {
  return String(head ?? "").trim().toUpperCase().replace(/\s+/g, " ");
}

/**
 * Allocate one student's receipts across their class's schedule.
 *
 * Receipts are processed oldest first (payment date, then receipt number) and
 * a running per-structure balance carries across them, so a student's second
 * payment picks up where the first left off. Callers MUST pass every receipt
 * for the student at once, including ones already imported — see
 * `alreadyFilledPaise` for how a partial re-import stays consistent.
 */
export function allocateStudentReceipts(args: {
  receipts: AllocatableReceipt[];
  scheduleByHead: Map<string, AllocatableStructure[]>;
  /**
   * Consulted only for a head the primary schedule does not carry at all —
   * see groupScheduleByHead. Omit it and an unbillable head is a problem
   * rather than a fallback.
   */
  fallbackByHead?: Map<string, AllocatableStructure[]>;
  /**
   * Money already sitting against a structure from an earlier batch or from a
   * native payment, in paise, keyed by fee_structure_id. The waterfall starts
   * on top of it so a re-run does not re-fill an instalment that is already
   * settled.
   */
  alreadyFilledPaise?: Map<string, number>;
}): AllocationResult {
  const { receipts, scheduleByHead, fallbackByHead } = args;
  const filled = new Map(args.alreadyFilledPaise ?? []);

  const slices: AllocationSlice[] = [];
  const problems: AllocationProblem[] = [];

  const ordered = [...receipts].sort((a, b) => {
    if (a.payment_date !== b.payment_date) {
      return a.payment_date < b.payment_date ? -1 : 1;
    }
    const an = Number(a.receipt_no);
    const bn = Number(b.receipt_no);
    if (Number.isFinite(an) && Number.isFinite(bn) && an !== bn) return an - bn;
    return a.receipt_no.localeCompare(b.receipt_no);
  });

  for (const receipt of ordered) {
    let sliceNo = 0;

    for (const headEntry of receipt.heads) {
      const key = normalizeHead(headEntry.head);
      const primary = scheduleByHead.get(key);
      const rows =
        primary && primary.length > 0 ? primary : fallbackByHead?.get(key);

      if (!rows || rows.length === 0) {
        problems.push({
          receipt_no: receipt.receipt_no,
          source_row: receipt.source_row,
          head: headEntry.head,
          amount: headEntry.amount,
          // "this class's fee schedule" is a placeholder the import route
          // rewrites with the actual class name — this module does not know it.
          message:
            `No active "${headEntry.head}" row in this class's fee schedule ` +
            `for the selected year. Publish it under Fees → Academic Fees → ` +
            `Fee Schedule, or copy it from another class with the same fees.`,
        });
        continue;
      }

      let remaining = toPaise(headEntry.amount);
      if (remaining <= 0) continue;

      for (const row of rows) {
        if (remaining <= 0) break;
        const capacity =
          toPaise(annualizedAmount(row)) - (filled.get(row.id) ?? 0);
        if (capacity <= 0) continue;

        const take = Math.min(capacity, remaining);
        filled.set(row.id, (filled.get(row.id) ?? 0) + take);
        remaining -= take;
        sliceNo += 1;

        slices.push({
          receipt_no: receipt.receipt_no,
          source_row: receipt.source_row,
          slice_no: sliceNo,
          head: headEntry.head,
          fee_structure_id: row.id,
          instalment_name: row.instalment_name ?? null,
          month_label: row.month_label ?? null,
          amount: fromPaise(take),
          partial: take < capacity,
          over_allocated: false,
        });
      }

      // Everything the schedule demands for this head is full and money is
      // left over. Park it on the head's last instalment rather than dropping
      // it: the rupees were received, and a total that does not reconcile is
      // worse than an attribution that is arguable.
      if (remaining > 0) {
        const last = rows[rows.length - 1];
        filled.set(last.id, (filled.get(last.id) ?? 0) + remaining);
        sliceNo += 1;
        slices.push({
          receipt_no: receipt.receipt_no,
          source_row: receipt.source_row,
          slice_no: sliceNo,
          head: headEntry.head,
          fee_structure_id: last.id,
          instalment_name: last.instalment_name ?? null,
          month_label: last.month_label ?? null,
          amount: fromPaise(remaining),
          partial: false,
          over_allocated: true,
        });
      }
    }
  }

  return { slices, problems };
}

/**
 * `DB-{yearPrefix}-{receiptNo}-{sliceNo}` — the human-facing receipt number.
 *
 * Always suffixed, even for a single-slice receipt, so the shape does not
 * change when a schedule edit later splits the same receipt in two. This is
 * display only; `fee_payments.source_receipt_no` is what dedupes a re-import,
 * precisely because these suffixes are not stable across schedule changes.
 */
export function buildImportReceiptNumber(
  yearPrefix: string,
  sourceReceiptNo: string,
  sliceNo: number
): string {
  return `DB-${yearPrefix}-${sourceReceiptNo}-${sliceNo}`;
}
