/**
 * The bulk-upload round-trip export.
 *
 * Superseded for general use by the Export dialog
 * (`@nkps/shared/components/ui/table-export-button`), which offers CSV, Excel
 * and PDF with a column picker on every list. What remains here is the one
 * thing that dialog deliberately does NOT do: emit the exact column headers
 * the student bulk importer expects, so a file can be downloaded, corrected in
 * Excel and uploaded straight back. That is a data-entry tool, not a report,
 * and its columns are fixed by the importer rather than chosen by the reader.
 */

import {
  STUDENT_TEMPLATE_FIELDS,
  formatFieldValue,
  indianNationalFromNationality,
} from "@nkps/shared/lib/student-template";
import { csvEscape } from "@nkps/shared/lib/utils";
import type { TableColumns } from "@nkps/shared/components/ui/data-table";

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


/**
 * The full student template as export-only table columns.
 *
 * Passed to `<TableExportButton extraColumns={…}>` so the export column picker
 * offers every one of the ~50 UDISE+ template fields, while the table on
 * screen keeps its handful. Derived from `STUDENT_TEMPLATE_FIELDS` rather than
 * restated, for the same reason `STUDENT_CSV_COLUMNS` is: that registry is the
 * single source of truth for what a field is called and how it renders, and a
 * second hand-maintained list of fifty entries would drift within a release.
 *
 * Fields already shown as real table columns are skipped — they come from the
 * page's own `columns` map, and offering them twice would put two "Class"
 * entries in the picker.
 */
const COLUMNS_ALREADY_ON_THE_TABLE = new Set([
  "admission_no",
  "full_name",
  "father_name",
  "class",
  "section",
  "roll_number",
  "gender",
  // `subjects` needs a per-student join the list payload does not carry, and
  // `stream` arrives as an id; both are handled by the server-side export.
  "subjects",
  "stream",
]);

const STUDENT_EXPORT_COLUMNS_BASE: TableColumns<Record<string, unknown>> =
  Object.fromEntries(
    STUDENT_TEMPLATE_FIELDS.filter(
      (field) => !COLUMNS_ALREADY_ON_THE_TABLE.has(field.key)
    ).map((field) => [
      field.key,
      {
        label: field.label,
        exportOnly: true,
        value: (row: Record<string, unknown>) => {
          if (field.key === "indian_national") {
            return formatFieldValue(
              field,
              indianNationalFromNationality(
                (row.nationality as string | null) ?? null
              )
            );
          }
          return formatFieldValue(field, row[field.key]) || null;
        },
        // Dates go out as real dates so a "date of birth" column can be sorted
        // and age-filtered in Excel rather than compared as text.
        ...(field.kind === "date"
          ? {
              exportFormat: "date" as const,
              exportValue: (row: Record<string, unknown>) =>
                (row[field.key] as string | null) ?? null,
            }
          : {}),
        ...(field.kind === "number" || field.kind === "integer"
          ? {
              exportFormat: "number" as const,
              exportValue: (row: Record<string, unknown>) =>
                (row[field.key] as number | null) ?? null,
            }
          : {}),
      },
    ])
  );

/**
 * The same map, typed for whatever row shape the calling page uses.
 *
 * Every accessor above reads the row by string key and nothing else, so the
 * cast is sound — but a page's row type (`StudentRow`) has no index signature,
 * and without this the `extraColumns` prop would pin the export button's
 * generic to `Record<string, unknown>` and reject the page's own controls.
 */
export function studentExportColumns<T>(): TableColumns<T> {
  return STUDENT_EXPORT_COLUMNS_BASE as unknown as TableColumns<T>;
}
