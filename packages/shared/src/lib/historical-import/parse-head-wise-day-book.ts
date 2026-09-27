// Parse the previous ERP software's "Day Book Head wise Report" XLSX.
//
// This is a DIFFERENT report from the one parse-account-wise-fees.ts reads.
// That one is one row per student with twelve month columns, each cell packing
// several payments into text. This one is one row per RECEIPT, with the money
// spread across head columns and the tender type recorded properly:
//
//   Row 0  "Day Book Head wise Report Session : 2026-2027 (14-Mar-2026 To 10-Sep-2026)"
//   Row 1  S.No. | Receipt Date | Receipt No | SR. No. | Student Name | Father Name |
//          Class | Section | Cheque No | Cheque Date | Cheque Bank | Payment Mode |
//          <one column per fee head> | Total
//   Rows 2+  the receipts
//   Last     "Total :- (Cash : 5717650 | Bank : 14702348 [Cheque: 1041300, Online: 13661048])"
//            with the per-head totals in the head columns.
//
// ── Head columns are read positionally, not from a fixed list ───────────────
// Everything strictly between "Payment Mode" and "Total" is a fee head. The
// sample in hand yields Admission Fee and Tuition Fee; a transport day book
// yields a Transport Fee column and parses here unchanged. Hard-coding the two
// heads would have meant a second parser for the next export.
//
// ── Dates ──────────────────────────────────────────────────────────────────
// The date cells are real Excel date cells, so the workbook is read WITHOUT
// `cellDates` and the underlying serial is converted arithmetically. This is
// deliberate and load-bearing:
//
//   * The displayed text is M/D/YY in this export ("3/14/26") while every
//     other Indian-school sheet the ERP reads is D/M/Y. Parsing the display
//     string would silently swap the day and month on all 1,530 receipts for
//     every date where both parts are ≤ 12 — about a third of them — and no
//     total would change, so nothing would catch it.
//   * `cellDates: true` builds the Date in the runtime's local zone, so
//     `.toISOString()` on an IST machine reports the previous day. Serial
//     arithmetic through excelSerialToDate() is pure UTC and gives the same
//     answer on a laptop in Jaipur and a Vercel function in UTC.
//
// A text date is still accepted as a fallback, but only when it is
// unambiguous. An ambiguous "5/4/26" raises a row error naming the fix rather
// than guessing, because guessing wrong is invisible.

import * as XLSX from "xlsx";
import { excelSerialToDate } from "../student-template";
import type {
  DayBookControlTotals,
  ParsedDayBook,
  ParsedDayBookHead,
  ParsedDayBookReceipt,
} from "./types";

/** Columns that must be present for this to be a Head-wise Day Book. */
const REQUIRED_HEADERS = [
  "S.No.",
  "Receipt Date",
  "Receipt No",
  "SR. No.",
  "Student Name",
  "Class",
  "Payment Mode",
  "Total",
] as const;

/** Optional columns — absent ones simply yield nulls. */
const OPTIONAL_HEADERS = [
  "Father Name",
  "Section",
  "Cheque No",
  "Cheque Date",
  "Cheque Bank",
] as const;

const MONTH_ABBR: Record<string, number> = {
  JAN: 1, FEB: 2, MAR: 3, APR: 4, MAY: 5, JUN: 6,
  JUL: 7, AUG: 8, SEP: 9, OCT: 10, NOV: 11, DEC: 12,
};

/** Uppercase, strip whitespace — used to match header cells. */
function normHeader(s: unknown): string {
  return String(s ?? "").trim().toUpperCase().replace(/\s+/g, "");
}

function findHeaderRow(rows: unknown[][]): number {
  for (let i = 0; i < Math.min(rows.length, 15); i++) {
    const row = rows[i];
    if (!row) continue;
    const set = new Set(row.map(normHeader));
    if (REQUIRED_HEADERS.every((k) => set.has(normHeader(k)))) return i;
  }
  return -1;
}

function buildHeaderIndex(headerRow: unknown[]): Map<string, number> {
  const idx = new Map<string, number>();
  headerRow.forEach((cell, i) => {
    const key = normHeader(cell);
    if (key && !idx.has(key)) idx.set(key, i);
  });
  return idx;
}

/** "14-Mar-2026" / a serial / "2026-03-14" → ISO. `null` when empty. */
function toIsoDate(cell: unknown): { iso: string | null; error?: string } {
  if (cell === null || cell === undefined || cell === "") return { iso: null };

  if (typeof cell === "number" && Number.isFinite(cell)) {
    // Excel serials below 1 are times of day, not dates.
    if (cell < 1) return { iso: null };
    return { iso: excelSerialToDate(cell) };
  }

  const text = String(cell).trim();
  if (!text) return { iso: null };

  if (/^\d{4}-\d{1,2}-\d{1,2}$/.test(text)) {
    const [y, m, d] = text.split("-");
    return { iso: `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}` };
  }

  // "14-Mar-2026" / "14 Mar 26" — unambiguous by construction.
  const named = /^(\d{1,2})[\s\-/]([A-Za-z]{3,})[\s\-/](\d{2,4})$/.exec(text);
  if (named) {
    const mon = MONTH_ABBR[named[2].slice(0, 3).toUpperCase()];
    if (mon) {
      const year = expandYear(Number(named[3]));
      return {
        iso: `${year}-${String(mon).padStart(2, "0")}-${named[1].padStart(2, "0")}`,
      };
    }
  }

  const slash = /^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/.exec(text);
  if (slash) {
    const a = Number(slash[1]);
    const b = Number(slash[2]);
    const year = expandYear(Number(slash[3]));
    // Only commit when exactly one ordering is possible.
    if (a > 12 && b <= 12) return { iso: fmt(year, b, a) }; // D/M
    if (b > 12 && a <= 12) return { iso: fmt(year, a, b) }; // M/D
    return {
      iso: null,
      error:
        `Date "${text}" is stored as text and could be either day/month or ` +
        `month/day. Re-export the report with real date cells, or widen the ` +
        `column so the date is unambiguous.`,
    };
  }

  return { iso: null, error: `Unrecognised date "${text}".` };
}

function fmt(y: number, m: number, d: number): string {
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function expandYear(y: number): number {
  if (y >= 1000) return y;
  return y < 50 ? 2000 + y : 1900 + y;
}

/** "1,23,500.00" / 4500 / "" → number. Non-numeric text → 0. */
function toAmount(cell: unknown): number {
  if (cell === null || cell === undefined || cell === "") return 0;
  if (typeof cell === "number") return Number.isFinite(cell) ? cell : 0;
  const cleaned = String(cell).replace(/[₹,\s]/g, "");
  if (!cleaned) return 0;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : 0;
}

function toText(cell: unknown): string {
  if (cell === null || cell === undefined) return "";
  return String(cell).trim();
}

/**
 * The old software's Payment Mode → our `fee_payments.payment_method`.
 *
 * An unrecognised mode falls back to 'historical_unknown' (migration 054)
 * rather than erroring: the tender type is metadata, and refusing to import a
 * receipt because its channel is spelled oddly would be the worse outcome. The
 * caller surfaces the fallback as a warning so it is never silent.
 */
export function normalizePaymentMode(raw: string): {
  method: string;
  recognised: boolean;
} {
  const k = raw.trim().toUpperCase().replace(/[\s._-]+/g, "");
  if (!k) return { method: "historical_unknown", recognised: false };
  if (k === "CASH") return { method: "cash", recognised: true };
  if (k === "ONLINE" || k === "NETBANKING") return { method: "online", recognised: true };
  if (k === "CHEQUE" || k === "CHECK" || k === "DD" || k === "DEMANDDRAFT") {
    return { method: "cheque", recognised: true };
  }
  if (k === "UPI") return { method: "upi", recognised: true };
  if (k === "NEFT" || k === "RTGS" || k === "IMPS" || k === "BANK" || k === "BANKTRANSFER") {
    return { method: "bank_transfer", recognised: true };
  }
  if (k === "CARD" || k === "GATEWAY" || k === "PAYTM" || k === "RAZORPAY") {
    return { method: "gateway", recognised: true };
  }
  return { method: "historical_unknown", recognised: false };
}

/**
 * Split the "Cheque Bank" cell into a bank name and a free-text note.
 *
 * The column is a dumping ground in practice. Most rows are a bank ("SBI",
 * "bob", "yes bank"), some are blank, and at least one in the sample holds a
 * 94-character adjustment note about a cancelled admission. Writing that into
 * `bank_name` would put prose in a column the receipt PDF prints as "Bank",
 * so anything that does not look like a bank name is routed to remarks.
 */
export function splitBankCell(raw: string): {
  bank_name: string | null;
  bank_note: string | null;
} {
  const text = raw.trim();
  if (!text) return { bank_name: null, bank_note: null };
  const words = text.split(/\s+/);
  const hasLetters = /[A-Za-z]/.test(text);
  if (!hasLetters || text.length > 40 || words.length > 4) {
    return { bank_name: null, bank_note: text };
  }
  return { bank_name: text.toUpperCase(), bank_note: null };
}

/** "… Session : 2026-2027 (14-Mar-2026 To 10-Sep-2026)" → the two dates. */
function parseTitle(title: string): {
  session_label: string | null;
  period_start: string | null;
  period_end: string | null;
} {
  const session = /Session\s*:\s*([0-9]{4}\s*-\s*[0-9]{2,4})/i.exec(title);
  const period = /\(\s*(.+?)\s+To\s+(.+?)\s*\)/i.exec(title);
  return {
    session_label: session ? session[1].replace(/\s+/g, "") : null,
    period_start: period ? toIsoDate(period[1]).iso : null,
    period_end: period ? toIsoDate(period[2]).iso : null,
  };
}

/**
 * "Total :- (Cash : 5717650 | Bank : 14702348 [Cheque: 1041300, Online: 13661048])"
 * → { cash: 5717650, cheque: 1041300, online: 13661048 }
 *
 * These are the file's own control totals. They are the only independent check
 * that the parse did not drop or double-count a row, so they are parsed rather
 * than ignored.
 */
function parseFooterModes(text: string): Record<string, number> {
  const out: Record<string, number> = {};
  const re = /\b(Cash|Cheque|Online|Bank|UPI|Card)\s*:\s*([\d,]+(?:\.\d+)?)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    out[m[1].toLowerCase()] = Number(m[2].replace(/,/g, ""));
  }
  return out;
}

export function parseHeadWiseDayBook(buf: ArrayBuffer | Uint8Array): ParsedDayBook {
  // No `cellDates` — see the header note. Date cells stay numeric serials.
  const workbook = XLSX.read(buf, { type: "array" });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) throw new Error("XLSX has no sheets");
  const sheet = workbook.Sheets[sheetName];
  if (!sheet) throw new Error(`Sheet "${sheetName}" not found in workbook`);

  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    defval: null,
    raw: true,
  });

  const headerRowIdx = findHeaderRow(rows);
  if (headerRowIdx < 0) {
    throw new Error(
      "Could not find the Head-wise Day Book column header. Expected a row " +
        `containing: ${REQUIRED_HEADERS.join(", ")}. If this is the "Day Book ` +
        '(Account Wise)" report instead, use the historical fees importer.'
    );
  }

  const headerRow = rows[headerRowIdx] ?? [];
  const idx = buildHeaderIndex(headerRow);
  const col = (name: string): number | undefined => idx.get(normHeader(name));

  const cSno = col("S.No.")!;
  const cDate = col("Receipt Date")!;
  const cReceipt = col("Receipt No")!;
  const cSr = col("SR. No.")!;
  const cName = col("Student Name")!;
  const cMode = col("Payment Mode")!;
  const cTotal = col("Total")!;
  const cFather = col("Father Name");
  const cClass = col("Class")!;
  const cSection = col("Section");
  const cInstrument = col("Cheque No");
  const cInstrumentDate = col("Cheque Date");
  const cBank = col("Cheque Bank");

  // Head columns: everything strictly between Payment Mode and Total.
  const headCols: Array<{ index: number; head: string }> = [];
  for (let i = cMode + 1; i < cTotal; i++) {
    const label = toText(headerRow[i]);
    if (label) headCols.push({ index: i, head: label });
  }
  if (headCols.length === 0) {
    throw new Error(
      'No fee-head columns found between "Payment Mode" and "Total". The ' +
        "report must carry at least one head column (Admission Fee, Tuition Fee…)."
    );
  }

  const warnings: string[] = [];
  const title = toText(rows[0]?.[0]) || toText(rows[headerRowIdx - 1]?.[0]);
  const { session_label, period_start, period_end } = parseTitle(title);

  const receipts: ParsedDayBookReceipt[] = [];
  const control: DayBookControlTotals = { by_mode: {}, by_head: {}, grand: null };
  let unrecognisedModes = new Set<string>();

  for (let i = headerRowIdx + 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row || row.every((c) => c === null || String(c).trim() === "")) continue;

    const sno = toText(row[cSno]);

    // Footer: the S.No. cell carries the whole "Total :- (…)" summary and the
    // head columns carry the per-head totals.
    if (/^total/i.test(sno)) {
      control.by_mode = parseFooterModes(sno);
      for (const { index, head } of headCols) {
        control.by_head[head] = toAmount(row[index]);
      }
      const grand = toAmount(row[cTotal]);
      control.grand = grand || null;
      continue;
    }

    const sourceRow = i + 1; // 1-indexed, matches what Excel shows the operator
    const rowErrors: string[] = [];

    const dateResult = toIsoDate(row[cDate]);
    if (dateResult.error) rowErrors.push(`Receipt Date: ${dateResult.error}`);

    const instrumentResult =
      cInstrumentDate === undefined
        ? { iso: null as string | null }
        : toIsoDate(row[cInstrumentDate]);
    if ("error" in instrumentResult && instrumentResult.error) {
      // Not fatal — the instrument date is metadata, not the business date.
      warnings.push(`Row ${sourceRow}: ${instrumentResult.error} Left blank.`);
    }

    const heads: ParsedDayBookHead[] = [];
    for (const { index, head } of headCols) {
      const amount = toAmount(row[index]);
      if (amount !== 0) heads.push({ head, amount });
    }

    const total = toAmount(row[cTotal]);
    const headSum = heads.reduce((s, h) => s + h.amount, 0);
    // Rounded to paise before comparing: the source stores rupees, but a
    // re-saved sheet can carry float dust.
    if (Math.round((headSum - total) * 100) !== 0) {
      rowErrors.push(
        `Head amounts total ${headSum} but the Total column says ${total}.`
      );
    }

    const modeRaw = toText(row[cMode]);
    const { method, recognised } = normalizePaymentMode(modeRaw);
    if (!recognised && modeRaw) unrecognisedModes.add(modeRaw);

    const { bank_name, bank_note } = splitBankCell(
      cBank === undefined ? "" : toText(row[cBank])
    );

    receipts.push({
      source_row: sourceRow,
      receipt_no: toText(row[cReceipt]),
      payment_date: dateResult.iso,
      instrument_date: instrumentResult.iso,
      admission_no: toText(row[cSr]) || null,
      student_name: toText(row[cName]),
      father_name: cFather === undefined ? "" : toText(row[cFather]),
      raw_class: toText(row[cClass]),
      raw_section: cSection === undefined ? "" : toText(row[cSection]),
      payment_mode_raw: modeRaw,
      payment_method: method,
      instrument_ref: cInstrument === undefined ? null : toText(row[cInstrument]) || null,
      bank_name,
      bank_note,
      heads,
      total,
      errors: rowErrors,
    });
  }

  if (unrecognisedModes.size > 0) {
    warnings.push(
      `Unrecognised payment mode(s) recorded as "historical_unknown": ` +
        `${[...unrecognisedModes].join(", ")}.`
    );
  }
  if (receipts.length === 0) {
    warnings.push("No receipt rows found in file.");
  }
  if (control.grand === null) {
    warnings.push(
      "The file has no Total row, so its own control totals could not be " +
        "cross-checked against the parsed rows."
    );
  }

  return {
    receipts,
    heads: headCols.map((h) => h.head),
    control,
    session_label,
    period_start,
    period_end,
    warnings,
  };
}
