/**
 * Describing a spreadsheet column without sending its contents anywhere.
 *
 * ── The problem ─────────────────────────────────────────────────────────────
 * `mapTemplateHeaders` matches headers by exact alias, then by substring. It
 * is fast and predictable and it fails on anything the alias list never
 * anticipated — a sheet with "F. Name" / "M. Name" columns maps neither, and
 * somebody retypes the headers by hand. Asking a model to match the leftovers
 * works well, but only if it can see what the column CONTAINS: "Contact 2"
 * is unguessable from its name and obvious the moment you know it holds
 * ten-digit numbers starting with a 9.
 *
 * ── Why this file exists rather than just sending three sample rows ─────────
 * Those sample rows are children's names, phone numbers and Aadhaar numbers.
 * Sending them to an external API to answer "what kind of column is this?" is
 * a real disclosure to solve a question that never needed the values — only
 * their SHAPE. So a column becomes "12 digits, all distinct" and the model can
 * tell Aadhaar from a mobile number without a single real one leaving.
 *
 * The one exception is deliberate and safe: a column with very few distinct
 * short values is a category, not an identity. "M / F", "GEN / OBC / SC",
 * "YES / NO" identify nobody, and knowing them is what separates gender from
 * a house name. High-cardinality columns — every name, every number, every
 * address — never enumerate, which is exactly the set that would matter.
 */

/** Enumerate a column's values only below this many distinct ones. */
const ENUM_MAX_DISTINCT = 12;
/** …and only when they are short. A long string is prose, not a category. */
const ENUM_MAX_LENGTH = 24;

export interface ColumnProfile {
  /** The header exactly as it appears in the sheet. */
  header: string;
  /** Position, so a mapping can be applied without matching on text. */
  index: number;
  /** How many rows have anything in this column. */
  filled: number;
  /** Distinct non-empty values seen. */
  distinct: number;
  /** "12 digits", "date", "1-3 words", "mixed" — never a real value. */
  shape: string;
  /** Character length range of the non-empty values. */
  minLength: number;
  maxLength: number;
  /**
   * The actual values, ONLY for low-cardinality short columns. Undefined
   * otherwise — see the header for why that boundary is the safe one.
   */
  values?: string[];
}

const DATE_RE = /^\d{1,4}[-/.]\d{1,2}[-/.]\d{1,4}$/;

function shapeOf(values: string[]): string {
  if (values.length === 0) return "empty";

  const allDigits = values.every((v) => /^\d+$/.test(v));
  if (allDigits) {
    const lengths = new Set(values.map((v) => v.length));
    return lengths.size === 1
      ? `${[...lengths][0]} digits`
      : `digits, ${Math.min(...lengths)}-${Math.max(...lengths)} long`;
  }

  if (values.every((v) => DATE_RE.test(v))) return "date";
  if (values.every((v) => /^-?\d+(\.\d+)?$/.test(v))) return "number";
  if (values.every((v) => /^[A-Za-z]$/.test(v))) return "single letter";
  if (values.every((v) => /^[\w.+-]+@[\w.-]+\.\w+$/.test(v))) return "email address";
  if (values.every((v) => /^[A-Za-z0-9][A-Za-z0-9\-/]*$/.test(v) && /\d/.test(v))) {
    return "alphanumeric code";
  }

  const wordCounts = values.map((v) => v.split(/\s+/).length);
  const min = Math.min(...wordCounts);
  const max = Math.max(...wordCounts);
  if (max <= 6) return min === max ? `${min} word${min === 1 ? "" : "s"}` : `${min}-${max} words`;
  return "free text";
}

/**
 * Profile one column from its raw cells.
 *
 * Deliberately takes the whole column rather than a sample: counting distinct
 * values across all rows is what makes the enumerate/redact decision correct,
 * and none of it leaves this function unless the low-cardinality test passes.
 */
export function describeColumn(
  header: string,
  index: number,
  cells: readonly unknown[]
): ColumnProfile {
  const values = cells
    .map((c) => (c == null ? "" : String(c).trim()))
    .filter((v) => v !== "");

  const unique = [...new Set(values)];
  const lengths = values.map((v) => v.length);

  const enumerable =
    unique.length > 0 &&
    unique.length <= ENUM_MAX_DISTINCT &&
    unique.every((v) => v.length <= ENUM_MAX_LENGTH);

  return {
    header,
    index,
    filled: values.length,
    distinct: unique.length,
    shape: shapeOf(values),
    minLength: lengths.length ? Math.min(...lengths) : 0,
    maxLength: lengths.length ? Math.max(...lengths) : 0,
    ...(enumerable ? { values: unique.sort() } : {}),
  };
}

/** Profile every column of a header row plus its data rows. */
export function describeColumns(
  headers: readonly string[],
  rows: readonly (readonly unknown[])[]
): ColumnProfile[] {
  return headers.map((header, index) =>
    describeColumn(String(header ?? ""), index, rows.map((r) => r[index]))
  );
}

export interface MappingSuggestion {
  /** Column index in the sheet. */
  index: number;
  /** Registry field key, or null when the column has no home. */
  fieldKey: string | null;
  confidence: "high" | "medium" | "low";
  /** One short line the operator can judge the suggestion by. */
  why: string;
}
