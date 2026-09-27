// XLSX writer for the list exports.
//
// `xlsx` (SheetJS) is ~900 KB minified. Today it is imported by three bulk
// upload components, so Next code-splits it onto three routes. The export
// button ships on ~30 routes across two apps, so the import here MUST stay
// dynamic and inside the function — a static import would put SheetJS in
// every admin bundle, including the CMS, which currently carries none of it.

import {
  matrixToText,
  type ExportCell,
  type ExportColumn,
} from "@nkps/shared/lib/table-export";

/** Rough character width → Excel column width, clamped to something sane. */
const MIN_COL_WIDTH = 8;
const MAX_COL_WIDTH = 42;

function columnWidths(headers: readonly string[], text: string[][]): number[] {
  return headers.map((header, index) => {
    let widest = header.length;
    // Sampling beats scanning every row on a 10k-row export, and a column's
    // width only has to look right, not be exact.
    const step = Math.max(1, Math.floor(text.length / 200));
    for (let row = 0; row < text.length; row += step) {
      const length = text[row][index]?.length ?? 0;
      if (length > widest) widest = length;
    }
    return Math.min(MAX_COL_WIDTH, Math.max(MIN_COL_WIDTH, widest + 2));
  });
}

/**
 * Cells are strings unless the column asked to be a number or a date.
 *
 * That default is the hardening: admission numbers, phone numbers, Aadhaar
 * and pincodes stay strings, so Excel neither eats their leading zeros nor
 * renders them as 1.23457E+14. It also covers formula injection — Excel does
 * not evaluate a string cell that begins with `=`, and the cell type here is
 * explicit rather than sniffed. Note this is why `csvEscape` must NOT be
 * applied on this path: its `'` prefix is a CSV-only fix and would corrupt
 * legitimate negative numbers.
 */
function toSheetCell(cell: ExportCell): unknown {
  switch (cell.kind) {
    case "number":
      return { t: "n", v: cell.value };
    case "date":
      return {
        t: "d",
        v: cell.value,
        z: cell.withTime ? "dd/mm/yyyy hh:mm" : "dd/mm/yyyy",
      };
    default:
      return { t: "s", v: cell.text };
  }
}

export interface XlsxOptions {
  /** Worksheet tab name. Excel caps this at 31 chars and forbids []:*?/\ */
  sheetName?: string;
}

function safeSheetName(name: string): string {
  const cleaned = name.replace(/[[\]:*?/\\]/g, " ").trim();
  return cleaned.slice(0, 31) || "Export";
}

export const XLSX_MIME =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

export async function buildXlsxBytes<T>(
  columns: readonly ExportColumn<T>[],
  matrix: readonly ExportCell[][],
  { sheetName = "Export" }: XlsxOptions = {}
): Promise<Uint8Array<ArrayBuffer>> {
  const XLSX = await import("xlsx");

  const headers = columns.map((column) => column.header);
  const sheet = XLSX.utils.aoa_to_sheet([headers], { cellDates: true });

  // Written cell by cell rather than through `aoa_to_sheet` so each one keeps
  // the type its column asked for; the array form would re-sniff every value.
  matrix.forEach((row, rowIndex) => {
    row.forEach((cell, columnIndex) => {
      const address = XLSX.utils.encode_cell({ r: rowIndex + 1, c: columnIndex });
      sheet[address] = toSheetCell(cell);
    });
  });

  sheet["!ref"] = XLSX.utils.encode_range({
    s: { r: 0, c: 0 },
    e: { r: matrix.length, c: Math.max(0, headers.length - 1) },
  });
  sheet["!cols"] = columnWidths(headers, matrixToText(matrix)).map((wch) => ({ wch }));
  // Excel's own filter dropdowns, so the file stays as sortable and filterable
  // as the table it came from. (Freeze panes are deliberately not set: this
  // build of SheetJS silently ignores `!freeze` on write — verified by
  // inspecting the emitted sheet XML — so setting it would be dead config
  // that reads as a working feature.)
  if (matrix.length > 0) {
    sheet["!autofilter"] = {
      ref: XLSX.utils.encode_range({
        s: { r: 0, c: 0 },
        e: { r: matrix.length, c: Math.max(0, headers.length - 1) },
      }),
    };
  }

  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, safeSheetName(sheetName));
  const buffer = XLSX.write(book, {
    type: "array",
    bookType: "xlsx",
    cellDates: true,
  }) as ArrayBuffer;

  return new Uint8Array(buffer);
}

/** Browser-side convenience wrapper; the server routes use the bytes directly. */
export async function buildXlsxBlob<T>(
  columns: readonly ExportColumn<T>[],
  matrix: readonly ExportCell[][],
  options: XlsxOptions = {}
): Promise<Blob> {
  const bytes = await buildXlsxBytes(columns, matrix, options);
  return new Blob([bytes], { type: XLSX_MIME });
}
