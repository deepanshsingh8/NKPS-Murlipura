/**
 * CSV Export utility for downloading data as CSV files.
 */

import {
  STUDENT_TEMPLATE_FIELDS,
  formatFieldValue,
  indianNationalFromNationality,
} from "@nkps/shared/lib/student-template";
import { csvEscape } from "@nkps/shared/lib/utils";

// Delegate to the shared csvEscape so this client-side export gets the same
// formula-injection hardening (leading = + - @) as the server CSV routes —
// student names/addresses are attacker-controllable via bulk import.
function escapeCSV(value: unknown): string {
  if (value === null || value === undefined) return "";
  return csvEscape(typeof value === "number" ? value : String(value));
}

export interface CsvColumn<T extends object = Record<string, unknown>> {
  key: string;
  header: string;
  /** Optional formatter; defaults to the raw row[key] value. */
  format?: (row: T) => string;
}

export function downloadCSV<T extends object>(
  rows: T[],
  columns: CsvColumn<T>[],
  filename: string
) {
  const header = columns.map((c) => escapeCSV(c.header)).join(",");
  const body = rows
    .map((row) =>
      columns
        .map((c) =>
          escapeCSV(
            c.format ? c.format(row) : (row as Record<string, unknown>)[c.key]
          )
        )
        .join(",")
    )
    .join("\n");

  const csv = `${header}\n${body}`;
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${filename}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

/**
 * Student CSV columns — generated from the shared template registry so the
 * headers equal the bulk-upload template's canonical headers. That makes the
 * listing export round-trip: download CSV → fix in Excel → bulk re-upload.
 * Booleans render as YES/NO, enums as their labels, dates as DD/MM/YYYY —
 * all of which the bulk importer parses back.
 *
 * Skipped registry keys: `subjects` (not part of the list payload; would need
 * a per-student query) and `stream` (the list rows carry stream_id only).
 */
export const STUDENT_CSV_COLUMNS: CsvColumn[] = [
  ...STUDENT_TEMPLATE_FIELDS.filter(
    (f) => f.key !== "subjects" && f.key !== "stream"
  ).map((field) => ({
    key: field.key,
    header: field.label,
    format: (row: Record<string, unknown>) => {
      switch (field.key) {
        case "section":
          return String(row.class_section ?? "");
        case "indian_national":
          return formatFieldValue(
            field,
            indianNationalFromNationality((row.nationality as string | null) ?? null)
          );
        default:
          return formatFieldValue(field, row[field.key]);
      }
    },
  })),
  { key: "enrollment_status", header: "Status" },
];

/** Staff CSV columns matching the bulk upload format */
export const STAFF_CSV_COLUMNS = [
  { key: "name", header: "Name" },
  { key: "subject", header: "Subject/Designation" },
  { key: "category", header: "Category" },
  { key: "email", header: "Email" },
  { key: "phone", header: "Phone" },
  { key: "date_of_birth", header: "Date of Birth" },
  { key: "address", header: "Address" },
  { key: "qualifications", header: "Qualifications" },
];
