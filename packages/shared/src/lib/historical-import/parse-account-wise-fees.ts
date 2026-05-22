// Parse the previous ERP software's "Day Book (Account Wise) Report" XLSX.
//
// Expected structure (confirmed from real samples):
//   • Rows 0–5 are decorative header lines (school name, address, report title)
//   • Row 6 is the column header. Required columns:
//       S.No., Class, Section, "SR | Student Name | Father Name",
//       APR, MAY, JUN, JUL, AUG, SEP, OCT, NOV, DEC, JAN, FEB, MAR, Total
//   • Rows 7+ are per-student rows. Each month cell can contain zero or more
//     payments in the form:  {amount} | {dd/mm/yyyy} | {receipt#}: (or ;)
//     Multiple payments are separated by whitespace.
//   • The "SR | Student Name | Father Name" cell is three pipe-separated
//     fields; SR (admission_no) can be blank for new admits.
//   • Last row may be a "Total" row — we skip it (S.No. == "Total").

import * as XLSX from "xlsx";
import type { ParsedFeePayment, ParsedFeeRow } from "./types";

const MONTH_COLUMNS = [
  "APR",
  "MAY",
  "JUN",
  "JUL",
  "AUG",
  "SEP",
  "OCT",
  "NOV",
  "DEC",
  "JAN",
  "FEB",
  "MAR",
] as const;
type MonthCol = (typeof MONTH_COLUMNS)[number];

const HEADER_KEYS_REQUIRED = [
  "S.No.",
  "Class",
  "Section",
  ...MONTH_COLUMNS,
] as const;

/** Strict normaliser used to match header cells against expected names. */
function normHeader(s: string): string {
  return String(s ?? "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "");
}

/** Find the header row by scanning the first 15 rows for the expected columns. */
function findHeaderRow(rows: unknown[][]): number {
  for (let i = 0; i < Math.min(rows.length, 15); i++) {
    const row = rows[i];
    if (!row) continue;
    const set = new Set(row.map((c) => normHeader(String(c ?? ""))));
    const allPresent = HEADER_KEYS_REQUIRED.every((k) => set.has(normHeader(k)));
    if (allPresent) return i;
  }
  return -1;
}

/** Map header → column index for the header row. */
function buildHeaderIndex(headerRow: unknown[]): Map<string, number> {
  const idx = new Map<string, number>();
  headerRow.forEach((cell, i) => {
    const key = normHeader(String(cell ?? ""));
    if (key && !idx.has(key)) idx.set(key, i);
  });
  return idx;
}

/** Parse a single month-cell into 0..N payment objects. */
function parseMonthCell(cell: string, month: MonthCol): ParsedFeePayment[] {
  if (!cell) return [];
  const text = String(cell).trim();
  if (!text || text === "0") return [];

  // Payment pattern: {amount} | {dd/mm/yyyy} | {receipt#}: (or ;)
  // Multiple payments in one cell are separated by the trailing colon/semicolon
  // followed by whitespace. We split on  `[:;]\s+`  but keep the receipt# in
  // the previous match by anchoring on the colon/semi at the END of each rec.
  //
  // Use a global regex that captures one record at a time.
  const re = /(\d+(?:\.\d+)?)\s*\|\s*(\d{1,2}\/\d{1,2}\/\d{2,4})\s*\|\s*(\d+)\s*[:;]/g;
  const out: ParsedFeePayment[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const [, amountStr, dateStr, receipt] = m;
    const amount = Number(amountStr);
    // Skip zero/invalid amounts. The old software sometimes records "0 | date |
    // receipt#" as a bookkeeping marker (e.g. waivers, fee-write-offs) but the
    // ERP's amount_positive constraint forbids non-waiver zero rows, so we
    // drop them here. If the school wants to ingest historical waivers
    // separately, we'll add a dedicated path later.
    if (!Number.isFinite(amount) || amount <= 0) continue;
    const iso = parseDdMmYyyy(dateStr);
    if (!iso) continue;
    out.push({
      amount,
      payment_date: iso,
      original_receipt: receipt,
      month,
      raw_cell: text,
    });
  }
  return out;
}

/** Convert "dd/mm/yyyy" or "dd/mm/yy" → ISO yyyy-mm-dd. */
function parseDdMmYyyy(s: string): string | null {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/.exec(s.trim());
  if (!m) return null;
  const [, dd, mm, yyyy] = m;
  let year = parseInt(yyyy, 10);
  if (year < 100) year = year < 50 ? 2000 + year : 1900 + year;
  const month = parseInt(mm, 10);
  const day = parseInt(dd, 10);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return `${year.toString().padStart(4, "0")}-${month
    .toString()
    .padStart(2, "0")}-${day.toString().padStart(2, "0")}`;
}

/** Split the combined "SR | Student Name | Father Name" cell. */
function parseStudentIdCell(raw: string): {
  admission_no: string | null;
  student_name: string;
  father_name: string;
} {
  // Examples:
  //   "2107 | GUNJAN SHARMA | MR. DEEPAK KUMAR SHARMA"  → SR present
  //   "| LAWRENCE | YUVRAJ GAUTAM"                       → SR blank
  //   "7316 | MOHAMMAD AMAN | MOHAMMAD SHAHID"
  const parts = String(raw).split("|").map((s) => s.trim());
  // Some cells may have fewer parts; pad to 3.
  while (parts.length < 3) parts.push("");
  const [sr, name, father] = parts;
  return {
    admission_no: sr ? sr : null,
    student_name: name,
    father_name: father,
  };
}

/**
 * Parse a Day Book (Account Wise) XLSX buffer into structured rows.
 * Throws if the header row can't be found (file format mismatch).
 */
export function parseAccountWiseFees(buf: ArrayBuffer | Uint8Array): {
  rows: ParsedFeeRow[];
  warnings: string[];
} {
  const workbook = XLSX.read(buf, { type: "array", cellDates: false });
  const firstSheetName = workbook.SheetNames[0];
  if (!firstSheetName) {
    throw new Error("XLSX has no sheets");
  }
  const sheet = workbook.Sheets[firstSheetName];
  if (!sheet) {
    throw new Error(`Sheet "${firstSheetName}" not found in workbook`);
  }
  const raw = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    defval: null,
    raw: false,
  });

  const headerRowIdx = findHeaderRow(raw);
  if (headerRowIdx < 0) {
    throw new Error(
      "Could not locate the column header row. Expected columns: " +
        HEADER_KEYS_REQUIRED.join(", ")
    );
  }
  const headerRow = raw[headerRowIdx] ?? [];
  const idx = buildHeaderIndex(headerRow);

  const colSno = idx.get(normHeader("S.No."));
  const colClass = idx.get(normHeader("Class"));
  const colSection = idx.get(normHeader("Section"));
  const colStudent = findStudentIdColumn(headerRow);
  const monthCols: Record<MonthCol, number | undefined> = Object.create(null);
  for (const m of MONTH_COLUMNS) {
    monthCols[m] = idx.get(normHeader(m));
  }
  const colTotal = idx.get(normHeader("Total"));

  if (
    colSno === undefined ||
    colClass === undefined ||
    colSection === undefined ||
    colStudent === undefined
  ) {
    throw new Error(
      "Header row found but required columns are missing. Need: S.No., Class, Section, and the combined Student column."
    );
  }

  const rows: ParsedFeeRow[] = [];
  const warnings: string[] = [];

  for (let i = headerRowIdx + 1; i < raw.length; i++) {
    const row = raw[i];
    if (!row || row.every((c) => c == null || String(c).trim() === "")) continue;
    const sno = String(row[colSno] ?? "").trim();
    if (!sno || sno.toUpperCase() === "TOTAL") continue;

    const rawClass = String(row[colClass] ?? "").trim();
    const rawSection = String(row[colSection] ?? "").trim();
    const { admission_no, student_name, father_name } = parseStudentIdCell(
      String(row[colStudent] ?? "")
    );

    const payments: ParsedFeePayment[] = [];
    for (const m of MONTH_COLUMNS) {
      const colIx = monthCols[m];
      if (colIx === undefined) continue;
      const cell = String(row[colIx] ?? "").trim();
      if (!cell) continue;
      payments.push(...parseMonthCell(cell, m));
    }

    const totalCell = colTotal !== undefined ? String(row[colTotal] ?? "0") : "0";
    const total = Number(totalCell.replace(/[, ]/g, "")) || 0;

    // Skip students with zero recorded payments — no useful data to import.
    if (payments.length === 0 && total === 0) continue;

    rows.push({
      source_row: i + 1, // 1-indexed for human-friendly errors
      raw_class: rawClass,
      raw_section: rawSection,
      admission_no,
      student_name,
      father_name,
      payments,
      total,
    });
  }

  if (rows.length === 0) {
    warnings.push("No payment rows found in file.");
  }

  return { rows, warnings };
}

/**
 * The "SR | Student Name | Father Name" column header can vary slightly
 * across exports. Find it by looking for a header containing "SR" and either
 * "Student" or "Father" with pipe separators implied by the data shape.
 */
function findStudentIdColumn(headerRow: unknown[]): number | undefined {
  for (let i = 0; i < headerRow.length; i++) {
    const cell = String(headerRow[i] ?? "");
    const upper = cell.toUpperCase();
    if (upper.includes("SR") && upper.includes("STUDENT") && upper.includes("FATHER")) {
      return i;
    }
  }
  // Fallback: a header cell containing two pipes is likely the student column.
  for (let i = 0; i < headerRow.length; i++) {
    const cell = String(headerRow[i] ?? "");
    if ((cell.match(/\|/g)?.length ?? 0) >= 2) return i;
  }
  return undefined;
}
