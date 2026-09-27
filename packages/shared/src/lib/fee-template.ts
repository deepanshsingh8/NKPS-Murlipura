/**
 * Fee-schedule bulk-upload template — single source of truth for the sheet's
 * headers, column widths, header-alias matching and per-cell normalisation.
 *
 * Mirrors the approach of student-template.ts: everything about the sheet is
 * declared once here, so the download, the parser and the preview cannot drift
 * apart. The columns map one-to-one onto `feeScheduleRowSchema` in
 * validations.ts, which the commit endpoint validates against.
 *
 * Deliberately NOT a second write path: parsed rows are grouped into
 * (class, stream) buckets and pushed through the existing
 * `POST /api/fees/schedule`, which already reconciles a whole grid
 * (insert / update / deactivate) for one bucket.
 */

export interface FeeTemplateField {
  key: string;
  label: string;
  /** Lowercased header spellings that should map to this column. */
  aliases: string[];
  required?: boolean;
  width: number;
  help: string;
}

export const FEE_TEMPLATE_FIELDS: FeeTemplateField[] = [
  {
    key: "class_name",
    label: "Class *",
    aliases: ["class", "class name", "classname", "std", "standard"],
    required: true,
    width: 10,
    help: "Nursery, LKG, UKG, I … XII. Must already exist for the session.",
  },
  {
    key: "stream_name",
    label: "Stream",
    aliases: ["stream", "stream name", "group"],
    width: 14,
    help: "XI/XII only (Science, Commerce, Humanities). Blank = applies to the whole class.",
  },
  {
    key: "instalment_no",
    label: "S No",
    aliases: ["s no", "sno", "s.no.", "instalment no", "installment no", "sr no"],
    width: 7,
    help: "Position of the instalment within the class's schedule. Blank is fine.",
  },
  {
    key: "fee_type",
    label: "Fee Head *",
    aliases: ["fee head", "fee type", "feehead", "head", "particulars"],
    required: true,
    width: 20,
    help: "Admission Fee, Tuition Fee, Annual Charges, …",
  },
  {
    key: "instalment_name",
    label: "Instalment Name",
    aliases: ["instalment name", "installment name", "instalment", "description"],
    width: 30,
    help: "Shown on receipts and the parent portal, e.g. 1st Instalment (Tuition).",
  },
  {
    key: "amount",
    label: "Amount *",
    aliases: ["amount", "fee", "fees", "value", "rs", "amount (rs)"],
    required: true,
    width: 12,
    help: "Rupees. Commas and a ₹ prefix are accepted.",
  },
  {
    key: "due_date",
    label: "Due Date *",
    aliases: ["due date", "duedate", "date", "due"],
    required: true,
    width: 13,
    help: "DD/MM/YYYY.",
  },
  {
    key: "student_type",
    label: "Student Type",
    aliases: ["student type", "studenttype", "applies to", "type"],
    width: 14,
    help: "New / Old / Both. Blank means Both.",
  },
  {
    key: "month_label",
    label: "Month Name",
    aliases: ["month name", "month", "month label", "period"],
    width: 14,
    help: "The period the instalment covers, e.g. April, 2026.",
  },
  {
    key: "late_fee_start_date",
    label: "Late Fee Start Date",
    aliases: ["late fee start date", "late fee from", "grace date", "late fee date"],
    width: 18,
    help: "DD/MM/YYYY. Blank = the late fee runs from the due date.",
  },
  {
    key: "late_fee_per_day",
    label: "Late Fee / Day",
    aliases: ["late fee / day", "late fee per day", "late fee day", "per day"],
    width: 13,
    help: "Rupees per day overdue. Blank or 0 = no late fee.",
  },
  {
    key: "late_fee_max",
    label: "Late Fee Max",
    aliases: ["late fee max", "max late fee", "late fee cap", "cap"],
    width: 13,
    help: "Upper limit on accumulated late fee. Blank = uncapped.",
  },
];

export function feeTemplateHeaders(): string[] {
  return FEE_TEMPLATE_FIELDS.map((f) => f.label);
}

export function feeTemplateColWidths(): { wch: number }[] {
  return FEE_TEMPLATE_FIELDS.map((f) => ({ wch: f.width }));
}

function normalizeHeader(s: string): string {
  return String(s ?? "")
    .trim()
    .toLowerCase()
    .replace(/\*/g, "")
    .replace(/[\s._-]+/g, " ")
    .trim();
}

/**
 * Map a sheet's header row onto field keys.
 *
 * Tolerant on purpose: these sheets are re-typed by hand every year, so
 * "Due date", "DUE DATE" and "Due  Date" must all land on the same column.
 * Headers that match nothing are reported rather than silently dropped —
 * a mistyped "Ammount" that vanished quietly would zero out a whole schedule.
 */
export function mapFeeTemplateHeaders(headers: string[]): {
  mapping: Record<number, string>;
  unrecognized: string[];
  missingRequired: string[];
} {
  const byAlias = new Map<string, string>();
  for (const f of FEE_TEMPLATE_FIELDS) {
    byAlias.set(normalizeHeader(f.label), f.key);
    byAlias.set(normalizeHeader(f.key), f.key);
    for (const a of f.aliases) byAlias.set(normalizeHeader(a), f.key);
  }

  const mapping: Record<number, string> = {};
  const unrecognized: string[] = [];
  const seen = new Set<string>();

  headers.forEach((h, i) => {
    const raw = String(h ?? "").trim();
    if (!raw) return;
    const key = byAlias.get(normalizeHeader(raw));
    if (!key || seen.has(key)) {
      if (!key) unrecognized.push(raw);
      return;
    }
    mapping[i] = key;
    seen.add(key);
  });

  const missingRequired = FEE_TEMPLATE_FIELDS.filter(
    (f) => f.required && !seen.has(f.key)
  ).map((f) => f.label);

  return { mapping, unrecognized, missingRequired };
}

/** "₹1,23,500.00" / "1,23,500" / 123500 → 123500. NaN when unparseable. */
export function parseFeeAmount(value: unknown): number {
  if (typeof value === "number") return value;
  const cleaned = String(value ?? "")
    .replace(/[₹,\s]/g, "")
    .trim();
  if (!cleaned) return NaN;
  return Number(cleaned);
}

/**
 * Excel dates arrive either as a serial number or as text. Returns ISO
 * yyyy-mm-dd, or null when the cell is blank/unparseable.
 *
 * DD/MM/YYYY is assumed for ambiguous slash dates — this is an Indian school,
 * and 03/04/2026 means 3 April here, never 4 March.
 */
export function parseFeeDate(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;

  if (typeof value === "number" && Number.isFinite(value)) {
    // Excel serial: days since 1899-12-30 (the 1900 leap-year bug included).
    const ms = Math.round((value - 25569) * 86400 * 1000);
    const d = new Date(ms);
    if (Number.isNaN(d.getTime())) return null;
    return d.toISOString().slice(0, 10);
  }

  const text = String(value).trim();
  if (!text) return null;

  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;

  const m = text.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2}|\d{4})$/);
  if (m) {
    const day = m[1].padStart(2, "0");
    const month = m[2].padStart(2, "0");
    const year = m[3].length === 2 ? `20${m[3]}` : m[3];
    if (Number(month) > 12) return null;
    return `${year}-${month}-${day}`;
  }

  const parsed = new Date(text);
  if (!Number.isNaN(parsed.getTime())) return parsed.toISOString().slice(0, 10);
  return null;
}

/** "New Student" / "old" / "" → the enum the schema expects. */
export function parseStudentType(value: unknown): "new" | "existing" | "both" {
  const t = String(value ?? "").trim().toLowerCase();
  if (!t) return "both";
  if (t.startsWith("new")) return "new";
  if (t.startsWith("old") || t.startsWith("exist")) return "existing";
  return "both";
}

/** Sample rows shipped in the template, showing the shapes that matter. */
export function feeTemplateSampleRows(): (string | number)[][] {
  return [
    ["V", "", 1, "Admission Fee", "Admission/Regn. Fee", 10500, "01/04/2026", "New Student", "", "", "", ""],
    ["V", "", 2, "Tuition Fee", "1st Instalment (Tuition)", 23500, "01/04/2026", "Both", "April, 2026", "12/07/2026", 50, 2000],
    ["V", "", 3, "Tuition Fee", "2nd Instalment (Tuition)", 23500, "01/10/2026", "Both", "Oct., 2026", "12/10/2026", 50, 2000],
    ["V", "", 4, "Tuition Fee", "3rd Instalment (Tuition)", 23500, "01/01/2027", "Both", "Jan., 2027", "12/01/2027", 50, 2000],
    ["XI", "Science", 1, "Tuition Fee", "1st Instalment (Tuition)", 31000, "01/04/2026", "Both", "April, 2026", "12/07/2026", 50, 2000],
  ];
}
