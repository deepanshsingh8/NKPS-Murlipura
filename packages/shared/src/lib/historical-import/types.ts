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
