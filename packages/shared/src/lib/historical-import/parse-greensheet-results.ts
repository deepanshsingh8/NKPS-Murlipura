// Parse the previous ERP software's "Result GreenSheet" XLSX.
//
// Expected structure (confirmed from real samples):
//   • Rows 0–4 (or 0–5) are decorative header lines (school name, contact)
//   • One row is the column header: detect by presence of "Sr", "SR No",
//     "Student Name", "Class", "Section", "Roll No"
//   • Per-student rows follow.
//   • For each subject in the class there are 6 columns in a fixed order:
//       "{SUBJECT} UPTO HALF YEARLY MAX. MARKS"
//       "{SUBJECT} UPTO HALF YEARLY OBT. MARKS"
//       "{SUBJECT} ANNUAL EXAM. MAX. MARKS"
//       "{SUBJECT} ANNUAL EXAM. OBT. MARKS"
//       "{SUBJECT} GRAND TOTAL MAX. MARKS"  (ignored — derivable)
//       "{SUBJECT} GRAND TOTAL OBT. MARKS"  (ignored — derivable)
//   • Marks may carry a trailing " D" (distinction marker) which we strip
//     and record as `has_distinction`.

import * as XLSX from "xlsx";
import type { ParsedResultsRow, ParsedSubjectMark } from "./types";

const FIXED_COLUMNS = [
  "Sr",
  "SR No",
  "Student Name",
  "Father Name",
  "Mother Name",
  "Category",
  "Dob",
  "Gender",
  "Class",
  "Section",
  "Roll No",
] as const;

function normHeader(s: string): string {
  return String(s ?? "")
    .trim()
    .toUpperCase()
    .replace(/\./g, "")
    .replace(/\s+/g, " ");
}

/** Find the header row by scanning for a row that contains the fixed columns. */
function findHeaderRow(rows: unknown[][]): number {
  for (let i = 0; i < Math.min(rows.length, 15); i++) {
    const row = rows[i];
    if (!row) continue;
    const cells = row.map((c) => normHeader(String(c ?? "")));
    const hasSrNo = cells.includes(normHeader("SR No"));
    const hasStudent = cells.includes(normHeader("Student Name"));
    const hasClass = cells.includes(normHeader("Class"));
    const hasRoll = cells.includes(normHeader("Roll No"));
    if (hasSrNo && hasStudent && hasClass && hasRoll) return i;
  }
  return -1;
}

interface SubjectColumns {
  subject: string;
  half_yearly_max: number;
  half_yearly_obt: number;
  annual_max: number;
  annual_obt: number;
}

const COL_TAGS = {
  HALF_MAX: "UPTO HALF YEARLY MAX MARKS",
  HALF_OBT: "UPTO HALF YEARLY OBT MARKS",
  ANNUAL_MAX: "ANNUAL EXAM MAX MARKS",
  ANNUAL_OBT: "ANNUAL EXAM OBT MARKS",
} as const;

/**
 * Walk the header row and group subject columns. For each subject we expect
 * 4 relevant columns in roughly this order. Tolerant to ordering quirks: we
 * group by the prefix before the tag.
 */
function detectSubjectColumns(headerRow: unknown[]): SubjectColumns[] {
  const cellsNorm = headerRow.map((c) => normHeader(String(c ?? "")));
  const groups = new Map<string, Partial<SubjectColumns> & { _cols: Record<string, number> }>();

  for (let i = 0; i < cellsNorm.length; i++) {
    const cell = cellsNorm[i];
    if (!cell) continue;

    let matchedTag: keyof typeof COL_TAGS | null = null;
    let subject = "";

    for (const [tagKey, tagValue] of Object.entries(COL_TAGS) as Array<
      [keyof typeof COL_TAGS, string]
    >) {
      if (cell.endsWith(" " + tagValue)) {
        matchedTag = tagKey;
        subject = cell.slice(0, cell.length - tagValue.length - 1).trim();
        break;
      }
    }
    if (!matchedTag || !subject) continue;

    if (!groups.has(subject)) {
      groups.set(subject, {
        subject,
        _cols: {},
      } as Partial<SubjectColumns> & { _cols: Record<string, number> });
    }
    groups.get(subject)!._cols[matchedTag] = i;
  }

  const result: SubjectColumns[] = [];
  for (const [subject, g] of groups) {
    const halfMax = g._cols["HALF_MAX"];
    const halfObt = g._cols["HALF_OBT"];
    const annMax = g._cols["ANNUAL_MAX"];
    const annObt = g._cols["ANNUAL_OBT"];
    if (
      halfMax === undefined ||
      halfObt === undefined ||
      annMax === undefined ||
      annObt === undefined
    ) {
      // Subject didn't have all 4 expected columns — skip.
      continue;
    }
    result.push({
      subject,
      half_yearly_max: halfMax,
      half_yearly_obt: halfObt,
      annual_max: annMax,
      annual_obt: annObt,
    });
  }
  return result;
}

/** Strip trailing " D" distinction marker; parse number; return both. */
function parseMarkCell(cell: unknown): { value: number | null; distinction: boolean } {
  if (cell == null) return { value: null, distinction: false };
  const raw = String(cell).trim();
  if (!raw) return { value: null, distinction: false };
  const dMatch = /^([0-9]+(?:\.[0-9]+)?)\s*D\b/i.exec(raw);
  if (dMatch) {
    const n = Number(dMatch[1]);
    return { value: Number.isFinite(n) ? n : null, distinction: true };
  }
  const n = Number(raw.replace(/[, ]/g, ""));
  return { value: Number.isFinite(n) ? n : null, distinction: false };
}

/** Build a column-name → index map for the fixed (non-subject) columns. */
function buildFixedIndex(headerRow: unknown[]): Map<string, number> {
  const idx = new Map<string, number>();
  for (const name of FIXED_COLUMNS) {
    const target = normHeader(name);
    for (let i = 0; i < headerRow.length; i++) {
      if (normHeader(String(headerRow[i] ?? "")) === target && !idx.has(name)) {
        idx.set(name, i);
        break;
      }
    }
  }
  return idx;
}

/**
 * Parse a ResultGreensheet XLSX buffer.
 * Returns one row per student × class with all subject marks flattened.
 */
export function parseGreensheetResults(buf: ArrayBuffer | Uint8Array): {
  rows: ParsedResultsRow[];
  subjects: string[];
  warnings: string[];
} {
  const workbook = XLSX.read(buf, { type: "array", cellDates: false });
  const warnings: string[] = [];
  const allRows: ParsedResultsRow[] = [];
  const seenSubjects = new Set<string>();

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) continue;
    const raw = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
      header: 1,
      defval: null,
      raw: false,
    });

    const headerRowIdx = findHeaderRow(raw);
    if (headerRowIdx < 0) {
      warnings.push(`Sheet "${sheetName}" skipped: no recognizable header row.`);
      continue;
    }
    const headerRow = raw[headerRowIdx] ?? [];
    const fixed = buildFixedIndex(headerRow);
    const subjectCols = detectSubjectColumns(headerRow);
    if (subjectCols.length === 0) {
      warnings.push(
        `Sheet "${sheetName}" skipped: header found but no subject column groups detected.`
      );
      continue;
    }
    for (const s of subjectCols) seenSubjects.add(s.subject);

    const colSrNo = fixed.get("SR No");
    const colStudent = fixed.get("Student Name");
    const colFather = fixed.get("Father Name");
    const colMother = fixed.get("Mother Name");
    const colDob = fixed.get("Dob");
    const colGender = fixed.get("Gender");
    const colClass = fixed.get("Class");
    const colSection = fixed.get("Section");
    const colRoll = fixed.get("Roll No");

    if (colSrNo === undefined || colStudent === undefined || colClass === undefined) {
      warnings.push(
        `Sheet "${sheetName}" skipped: missing one of SR No / Student Name / Class.`
      );
      continue;
    }

    for (let i = headerRowIdx + 1; i < raw.length; i++) {
      const row = raw[i];
      if (!row || row.every((c) => c == null || String(c).trim() === "")) continue;
      const sr = String(row[colSrNo] ?? "").trim();
      if (!sr) continue;

      const marks: ParsedSubjectMark[] = [];
      for (const s of subjectCols) {
        const half = parseMarkCell(row[s.half_yearly_obt]);
        const halfMax = parseMarkCell(row[s.half_yearly_max]);
        const annual = parseMarkCell(row[s.annual_obt]);
        const annualMax = parseMarkCell(row[s.annual_max]);

        if (half.value != null && halfMax.value != null && halfMax.value > 0) {
          marks.push({
            subject: s.subject,
            exam: "Half Yearly",
            max_marks: halfMax.value,
            obtained: half.value,
            has_distinction: half.distinction,
          });
        }
        if (annual.value != null && annualMax.value != null && annualMax.value > 0) {
          marks.push({
            subject: s.subject,
            exam: "Annual",
            max_marks: annualMax.value,
            obtained: annual.value,
            has_distinction: annual.distinction,
          });
        }
      }

      if (marks.length === 0) continue;

      allRows.push({
        source_row: i + 1,
        raw_class: colClass !== undefined ? String(row[colClass] ?? "").trim() : "",
        raw_section: colSection !== undefined ? String(row[colSection] ?? "").trim() : "",
        admission_no: sr,
        student_name: colStudent !== undefined ? String(row[colStudent] ?? "").trim() : "",
        father_name: colFather !== undefined ? String(row[colFather] ?? "").trim() : "",
        mother_name: colMother !== undefined ? String(row[colMother] ?? "").trim() : "",
        dob: colDob !== undefined ? (String(row[colDob] ?? "").trim() || null) : null,
        gender: colGender !== undefined ? (String(row[colGender] ?? "").trim() || null) : null,
        roll_no: colRoll !== undefined ? (String(row[colRoll] ?? "").trim() || null) : null,
        marks,
      });
    }
  }

  if (allRows.length === 0) {
    warnings.push("No result rows found in file.");
  }

  return { rows: allRows, subjects: [...seenSubjects].sort(), warnings };
}
