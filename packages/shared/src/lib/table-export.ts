// Format-agnostic core for the admin list exports.
//
// Deliberately pure: no React, no `xlsx`, no DOM at module scope. Both the
// browser (CSV/XLSX for the operational tables) and the server export routes
// (the sensitive datasets, which are generated and audited server-side) build
// their files through this module, so a fee column is a number and a date is a
// date no matter which side produced the file.
//
// The unit of work is an `ExportCell`, not a string. Writing everything as
// text is what makes the existing exports unusable in practice — Excel can
// neither sum a "₹1,23,456" column nor sort a "12 Jan 2026" one.

import { csvEscape } from "@nkps/shared/lib/utils";

/** How a cell should be typed in the output file. */
export type ExportFormat = "text" | "number" | "currency" | "date" | "datetime";

/** The file the admin asked for. */
export type ExportFileFormat = "csv" | "xlsx" | "pdf";

export type ExportSourceValue = string | number | boolean | null | undefined;

/**
 * One column of an export, decoupled from where it came from. Table exports
 * adapt a `TableColumns` map into these (see `table-export-columns.ts`);
 * server routes build them from their own field registries.
 */
export interface ExportColumn<T> {
  key: string;
  header: string;
  format: ExportFormat;
  /** Display text — for CSV and PDF, and the fallback for XLSX. */
  text: (row: T) => string;
  /**
   * Unformatted source for non-text formats. When it yields something
   * unparseable the cell degrades to `text` rather than emitting a wrong
   * number, so a stray "N/A" in a fee column can never become 0.
   */
  raw?: (row: T) => ExportSourceValue;
}

/**
 * A cell plus the type it should be written as. `text` is always populated so
 * CSV and PDF can ignore `kind` entirely.
 */
export type ExportCell =
  | { kind: "text"; text: string }
  | { kind: "number"; text: string; value: number }
  | { kind: "date"; text: string; value: Date; withTime: boolean };

/** Excel refuses to open a workbook with a cell longer than this. */
const MAX_CELL_CHARS = 32767;

const TRUNCATION_SUFFIX = "…";

/**
 * Every date in an export is rendered in the school's own convention,
 * regardless of the exporting browser's locale.
 *
 * On screen a bare `toLocaleDateString()` merely looks odd to a visitor; in a
 * downloaded file it is a correctness bug, because 03/04/2026 read six months
 * later is genuinely ambiguous and nothing in the file says which convention
 * produced it.
 */
const DATE_LOCALE = "en-IN";
const DATE_TIME_ZONE = "Asia/Kolkata";

const dateFormatter = new Intl.DateTimeFormat(DATE_LOCALE, {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  timeZone: DATE_TIME_ZONE,
});

const dateTimeFormatter = new Intl.DateTimeFormat(DATE_LOCALE, {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: true,
  timeZone: DATE_TIME_ZONE,
});

function toDate(value: ExportSourceValue): Date | null {
  if (value === null || value === undefined || value === "") return null;
  // Epoch milliseconds: several columns already sort by `Date.getTime()`, so
  // that is what `sortValue` hands us when it doubles as the export source.
  const date =
    typeof value === "number" ? new Date(value) : new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date;
}

function toNumber(value: ExportSourceValue): number | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "boolean") return value ? 1 : 0;
  // Tolerate a display string that slipped through: "₹1,23,456.00" → 123456.
  const cleaned = String(value).replace(/[^0-9.\-]/g, "");
  if (cleaned === "" || cleaned === "-" || cleaned === ".") return null;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

function truncate(text: string): string {
  if (text.length <= MAX_CELL_CHARS) return text;
  return text.slice(0, MAX_CELL_CHARS - TRUNCATION_SUFFIX.length) + TRUNCATION_SUFFIX;
}

/** Build one typed cell, degrading to text whenever the raw value is unusable. */
function buildExportCell<T>(column: ExportColumn<T>, row: T): ExportCell {
  const text = truncate(column.text(row) ?? "");
  if (column.format === "text") return { kind: "text", text };

  const raw = column.raw ? column.raw(row) : undefined;

  if (column.format === "number" || column.format === "currency") {
    const value = toNumber(raw);
    return value === null ? { kind: "text", text } : { kind: "number", text, value };
  }

  const date = toDate(raw);
  if (!date) return { kind: "text", text };
  const withTime = column.format === "datetime";
  return {
    kind: "date",
    // Re-render from the raw value so the file's date convention is the
    // school's even when the on-screen cell was formatted some other way.
    text: withTime ? dateTimeFormatter.format(date) : dateFormatter.format(date),
    value: date,
    withTime,
  };
}

export function buildExportMatrix<T>(
  rows: readonly T[],
  columns: readonly ExportColumn<T>[]
): ExportCell[][] {
  return rows.map((row) => columns.map((column) => buildExportCell(column, row)));
}

/** Plain display text, for CSV and the PDF renderer. */
export function matrixToText(matrix: readonly ExportCell[][]): string[][] {
  return matrix.map((row) => row.map((cell) => cell.text));
}

/**
 * RFC 4180 CSV. `csvEscape` also neutralises a leading `= + - @`, which
 * matters because student names and addresses are attacker-controllable
 * through the bulk importer.
 */
export function toCsv(
  headers: readonly string[],
  matrix: readonly ExportCell[][]
): string {
  const lines = [headers.map((h) => csvEscape(h)).join(",")];
  for (const row of matrix) {
    lines.push(row.map((cell) => csvEscape(cell.text)).join(","));
  }
  // Excel on Windows is the dominant reader here and wants CRLF.
  return lines.join("\r\n");
}

/** Columns whose values read better right-aligned in the PDF. */
export function exportAligns<T>(
  columns: readonly ExportColumn<T>[]
): ("left" | "right")[] {
  return columns.map((c) =>
    c.format === "number" || c.format === "currency" ? "right" : "left"
  );
}

const FILENAME_MAX = 120;

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * A filename that says what is inside it, so a folder of exports stays
 * readable: `students-class-xi-a-female-2026-08-22`.
 *
 * `parts` are the active filters. They are slugged and appended until the
 * budget runs out — a filter set long enough to overflow is better truncated
 * than turned into an unopenable path.
 */
export function exportFilename(
  base: string,
  parts: readonly string[] = [],
  today: Date = new Date()
): string {
  const stamp = [
    today.getFullYear(),
    String(today.getMonth() + 1).padStart(2, "0"),
    String(today.getDate()).padStart(2, "0"),
  ].join("-");

  let name = slugify(base) || "export";
  for (const part of parts) {
    const slug = slugify(part);
    if (!slug) continue;
    if (name.length + slug.length + stamp.length + 2 > FILENAME_MAX) break;
    name += `-${slug}`;
  }
  return `${name}-${stamp}`;
}

/** Hand a generated file to the browser. No-op outside one. */
export function downloadBlob(blob: Blob, filename: string): void {
  if (typeof document === "undefined") return;
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

/**
 * Written as an escape, not a literal character: a bare BOM is invisible in an
 * editor and a formatter that strips it would break Excel's encoding detection
 * with nothing in the diff to show for it.
 */
export const UTF8_BOM = "\uFEFF";

export function csvBlob(csv: string): Blob {
  // The BOM is what makes Excel read the file as UTF-8 rather than the
  // system codepage; without it Hindi names and the ₹ sign arrive as mojibake.
  return new Blob([UTF8_BOM, csv], { type: "text/csv;charset=utf-8;" });
}
