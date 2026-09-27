// Shared types for the historical bulk-import flow.
//
// Both the fees and results importers share a row-result shape so the UI
// can render previews and error tables with one component.

import type { NormalizedClass } from "./class-name-map";

export interface ParsedFeePayment {
  amount: number;
  payment_date: string; // ISO yyyy-mm-dd
  original_receipt: string; // raw receipt# from old software (e.g. "139")
  month: string; // "APR".."MAR"
  raw_cell: string; // for diagnostics
}

export interface ParsedFeeRow {
  source_row: number; // 1-indexed row in the xlsx
  raw_class: string;
  raw_section: string;
  admission_no: string | null; // may be blank in source
  student_name: string;
  father_name: string;
  payments: ParsedFeePayment[];
  total: number;
}

export interface ParsedResultsRow {
  source_row: number; // 1-indexed row in the xlsx
  raw_class: string;
  raw_section: string;
  admission_no: string;
  student_name: string;
  father_name: string;
  mother_name: string;
  dob: string | null;
  gender: string | null;
  roll_no: string | null;
  marks: ParsedSubjectMark[];
}

export interface ParsedSubjectMark {
  subject: string; // e.g. "HINDI", "MATHEMATICS"
  exam: "Half Yearly" | "Annual";
  max_marks: number;
  obtained: number;
  has_distinction: boolean; // marks with " D" suffix
}

export interface RowResult {
  source_row: number;
  ok: boolean;
  error?: string;
  resolved_student_id?: string;
  resolved_class_id?: string;
  payments_count?: number; // fees
  marks_count?: number; // results
}

export interface ImportSummary {
  total_rows: number;
  ok_rows: number;
  error_rows: number;
  payments_to_create?: number; // fees
  results_to_create?: number; // results
  dry_run: boolean;
  committed: boolean;
  batch_id?: string; // populated on successful commit
  unmapped_classes: string[]; // distinct raw class names not in the built-in map
}

export interface DryRunResponse {
  summary: ImportSummary;
  rows: RowResult[];
  unmapped_classes: string[]; // distinct raw class names the user must map
}

// User-supplied mapping from the dialog. Sent on the commit request to
// resolve any classes the built-in map didn't recognize.
export type ClassMappingOverrides = Record<string, NormalizedClass>;

// ── Head-wise Day Book (one row per receipt) ────────────────────────────────
//
// Distinct from ParsedFeeRow above, which models the Account-wise report's
// one-row-per-student shape. This report names the tender type and the
// instrument, and splits the money across fee-head columns, so a receipt here
// carries strictly more information than a payment there.

export interface ParsedDayBookHead {
  /** The head column's label, verbatim: "Admission Fee", "Tuition Fee". */
  head: string;
  amount: number;
}

export interface ParsedDayBookReceipt {
  source_row: number; // 1-indexed row in the xlsx, as Excel shows it
  receipt_no: string; // the old software's own number — the idempotency key
  payment_date: string | null; // ISO; null only when the cell was unparseable
  instrument_date: string | null; // the "Cheque Date" column
  admission_no: string | null; // the "SR. No." column
  student_name: string;
  father_name: string;
  raw_class: string;
  raw_section: string;
  payment_mode_raw: string; // as printed, for diagnostics
  payment_method: string; // normalized to the fee_payments CHECK
  instrument_ref: string | null; // cheque number, or the online txn reference
  bank_name: string | null;
  bank_note: string | null; // bank cell contents that were prose, not a bank
  heads: ParsedDayBookHead[]; // zero-amount heads are dropped
  total: number;
  /** Structural problems with this row. A non-empty list blocks the row. */
  errors: string[];
}

export interface DayBookControlTotals {
  /** From the footer text: { cash, cheque, online, bank }. */
  by_mode: Record<string, number>;
  /** From the footer's head columns. */
  by_head: Record<string, number>;
  grand: number | null;
}

export interface ParsedDayBook {
  receipts: ParsedDayBookReceipt[];
  /** Head column labels, in sheet order. */
  heads: string[];
  control: DayBookControlTotals;
  session_label: string | null; // "2026-2027"
  period_start: string | null; // ISO
  period_end: string | null; // ISO
  warnings: string[];
}

/**
 * Operator-supplied mapping from a source head label to a `fee_structures`
 * fee_type, for heads the built-in list does not recognise. Same round-trip
 * shape as ClassMappingOverrides.
 */
export type HeadMappingOverrides = Record<string, string>;
