import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Turning a raw `fee_payments` row into something a human can review.
 *
 * Background: a fee change request stores the whole target row — the
 * `current_snapshot` the editor saw, and the `proposed_changes` they want
 * applied. Both are plain JSON of database columns, so the review dialog used
 * to render them verbatim: `student_id → 514c65f6-794e-459d-a68d-af1787162db4`,
 * `academic_year_id → 88dd4a99-…`, `recorded_by → da3c5cef-…`.
 *
 * That is unreviewable. The admin approving a waiver has to know *which
 * student* and *which fee head* is being waived, and a UUID tells them
 * nothing. It is also the one rule this UI must never break: no database id
 * is ever shown to a user.
 *
 * So this module is the single place that says, per column:
 *
 *  - `FIELD_LABELS`    — the words the reviewer reads instead of the column name.
 *  - `HIDDEN_FIELDS`   — plumbing the reviewer never needs (surrogate keys,
 *                        row timestamps, the import batch tag).
 *  - `REFERENCE_FIELDS`— which columns hold a foreign key, and therefore have
 *                        to be resolved to a name before they can be rendered.
 *
 * `resolveEntityLabels` does the resolving server-side (service-role, one
 * round-trip per referenced table); `formatFieldValue` does the rendering
 * client-side and ends with a hard backstop: anything still shaped like a UUID
 * is replaced, never printed.
 *
 * Kept in `apps/erp/src/lib` because both the API routes that build the
 * response and the page that renders it must agree on the same catalog.
 */

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A value that would leak a database id if it reached the screen. */
export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

/** Shown when a referenced row has been deleted since the request was filed. */
export const UNRESOLVED_LABEL = "Unknown record";

/**
 * Columns dropped from the review tables outright.
 *
 * These are surrogate keys and bookkeeping stamps: they carry no information
 * the reviewer can act on, and `id` / `import_batch_id` / `payment_order_id`
 * are database ids with nothing to resolve them against.
 */
export const HIDDEN_FIELDS = new Set<string>([
  "id",
  "created_at",
  "updated_at",
  "import_batch_id",
  "payment_order_id",
]);

/** Column name → the words the reviewer reads. */
export const FIELD_LABELS: Record<string, string> = {
  student_id: "Student",
  fee_structure_id: "Fee head",
  academic_year_id: "Academic session",
  amount_paid: "Amount paid",
  payment_date: "Payment date",
  payment_method: "Payment mode",
  receipt_number: "Receipt no.",
  month: "Month",
  status: "Status",
  recorded_by: "Recorded by",
  remarks: "Remarks",
  source: "Source",
  source_receipt_no: "Original receipt no.",
  waiver_amount: "Waiver amount",
  waiver_reason: "Waiver reason",
  refund_amount: "Refund amount",
  refund_reason: "Refund reason",
  refunded_at: "Refunded on",
  refunded_by: "Refunded by",
  cheque_number: "Cheque no.",
  cheque_date: "Cheque date",
  bank_name: "Bank",
  payer_name: "Paid by",
  transaction_ref: "Transaction reference",
  payment_provider: "Payment provider",
  gateway_payment_id: "Gateway reference",
  gateway_receipt: "Gateway receipt",
  stream_id: "Stream",
};

interface ReferenceTable {
  /** Columns the label is built from. Must include `id`. */
  select: string;
  format: (row: Record<string, unknown>) => string;
}

function text(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * How each referenced table names itself.
 *
 * Keyed by table rather than by column so two columns pointing at the same
 * table (`recorded_by` and `refunded_by` both point at `profiles`) cannot
 * drift into two different label formats.
 */
export const REFERENCE_TABLES: Record<string, ReferenceTable> = {
  students: {
    select: "id, full_name, admission_no",
    format: (r) => {
      const name = text(r.full_name) ?? "Unnamed student";
      const adm = text(r.admission_no);
      return adm ? `${name} (${adm})` : name;
    },
  },
  fee_structures: {
    select: "id, fee_type, class_name, instalment_name, frequency",
    format: (r) => {
      const parts = [text(r.fee_type) ?? "Fee"];
      const cls = text(r.class_name);
      if (cls) parts.push(`Class ${cls}`);
      const instalment = text(r.instalment_name);
      if (instalment) parts.push(instalment);
      else {
        const freq = text(r.frequency);
        if (freq) parts.push(freq);
      }
      return parts.join(" · ");
    },
  },
  academic_years: {
    select: "id, name",
    format: (r) => text(r.name) ?? UNRESOLVED_LABEL,
  },
  profiles: {
    select: "id, full_name, email",
    format: (r) => text(r.full_name) ?? text(r.email) ?? "Unknown user",
  },
  streams: {
    select: "id, name",
    format: (r) => text(r.name) ?? UNRESOLVED_LABEL,
  },
};

/** FK column → the table it points at. */
export const REFERENCE_FIELDS: Record<string, string> = {
  student_id: "students",
  fee_structure_id: "fee_structures",
  academic_year_id: "academic_years",
  recorded_by: "profiles",
  refunded_by: "profiles",
  stream_id: "streams",
};

/** Resolved id → display label, as returned by the API. */
export type EntityLabels = Record<string, string>;

type MinimalClient = Pick<SupabaseClient, "from">;

/**
 * Resolve every foreign key in the given rows to a display label.
 *
 * Takes the request's `proposed_changes`, `current_snapshot` and the live row
 * together so one pass covers the whole dialog, and issues at most one query
 * per referenced table. Must be called with the service-role client: the
 * reviewer may not have direct read access to every referenced table.
 */
export async function resolveEntityLabels(
  admin: MinimalClient,
  rows: Array<Record<string, unknown> | null | undefined>
): Promise<EntityLabels> {
  const idsByTable = new Map<string, Set<string>>();
  for (const row of rows) {
    if (!row) continue;
    for (const [column, value] of Object.entries(row)) {
      const table = REFERENCE_FIELDS[column];
      if (!table || !isUuid(value)) continue;
      const bucket = idsByTable.get(table) ?? new Set<string>();
      bucket.add(value);
      idsByTable.set(table, bucket);
    }
  }

  const labels: EntityLabels = {};
  await Promise.all(
    Array.from(idsByTable.entries()).map(async ([table, ids]) => {
      const spec = REFERENCE_TABLES[table];
      if (!spec) return;
      const { data, error } = await admin
        .from(table)
        .select(spec.select)
        .in("id", Array.from(ids));
      if (error) {
        // A missing label degrades to UNRESOLVED_LABEL in the UI, which is
        // still better than printing the id.
        console.error(`[change-request-display] resolve ${table}:`, error);
        return;
      }
      for (const raw of data ?? []) {
        // The table name is dynamic, so the client cannot type the row.
        const record = raw as unknown as Record<string, unknown>;
        const id = text(record.id);
        if (id) labels[id] = spec.format(record);
      }
    })
  );
  return labels;
}

/** Column name → label, falling back to a humanised column name. */
export function fieldLabel(column: string): string {
  const known = FIELD_LABELS[column];
  if (known) return known;
  const words = column.replace(/_id$/, "").replace(/_/g, " ").trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

const PAYMENT_METHOD_LABELS: Record<string, string> = {
  cash: "Cash",
  online: "Online",
  cheque: "Cheque",
  bank_transfer: "Bank transfer",
  upi: "UPI",
  gateway: "Payment gateway",
  waiver: "Waiver (no money collected)",
};

const STATUS_LABELS: Record<string, string> = {
  pending: "Pending",
  processing: "Processing",
  paid: "Paid",
  partial: "Partially paid",
  failed: "Failed",
  refunded: "Refunded",
};

const SOURCE_LABELS: Record<string, string> = {
  erp_native: "Recorded in ERP",
  historical_import: "Historical import",
};

const ENUM_LABELS: Record<string, Record<string, string>> = {
  payment_method: PAYMENT_METHOD_LABELS,
  status: STATUS_LABELS,
  source: SOURCE_LABELS,
};

const CURRENCY_FIELDS = new Set([
  "amount",
  "amount_paid",
  "waiver_amount",
  "refund_amount",
  "transport_fee_override",
]);

const DATE_FIELDS = new Set([
  "payment_date",
  "cheque_date",
  "due_date",
  "enrollment_date",
  "exit_date",
]);

const TIMESTAMP_FIELDS = new Set(["refunded_at", "reviewed_at", "requested_at"]);

export function formatCurrency(value: number): string {
  return `₹${value.toLocaleString("en-IN", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  })}`;
}

function formatDate(value: string): string {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function formatDateTime(value: string): string {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });
}

/**
 * Render one column's value for the reviewer.
 *
 * The last two branches are the guarantee: a foreign key is shown as its
 * resolved name, and *any* remaining UUID-shaped value — a column nobody has
 * added to `REFERENCE_FIELDS` yet — is replaced rather than printed.
 */
export function formatFieldValue(
  column: string,
  value: unknown,
  labels: EntityLabels = {}
): string {
  if (value === null || value === undefined || value === "") return "—";

  if (isUuid(value)) return labels[value] ?? UNRESOLVED_LABEL;

  if (typeof value === "boolean") return value ? "Yes" : "No";

  const enumLabels = ENUM_LABELS[column];
  if (enumLabels && typeof value === "string") {
    const mapped = enumLabels[value];
    if (mapped) return mapped;
  }

  if (CURRENCY_FIELDS.has(column)) {
    const n = typeof value === "number" ? value : Number(value);
    if (!Number.isNaN(n)) return formatCurrency(n);
  }

  if (typeof value === "string") {
    if (DATE_FIELDS.has(column)) return formatDate(value);
    if (TIMESTAMP_FIELDS.has(column)) return formatDateTime(value);
    return value;
  }

  if (typeof value === "number") return value.toLocaleString("en-IN");

  // Nested JSON — flatten it, then re-check for ids so a UUID buried inside
  // an object does not slip through the backstop above.
  return JSON.stringify(value).replace(
    new RegExp(UUID_RE.source, "gi"),
    (id) => labels[id] ?? UNRESOLVED_LABEL
  );
}

/** The columns worth showing, in a stable, reviewer-friendly order. */
const FIELD_ORDER = [
  "student_id",
  "fee_structure_id",
  "academic_year_id",
  "month",
  "amount_paid",
  "waiver_amount",
  "waiver_reason",
  "refund_amount",
  "refund_reason",
  "refunded_at",
  "refunded_by",
  "payment_method",
  "payment_date",
  "status",
  "receipt_number",
  "payer_name",
  "bank_name",
  "cheque_number",
  "cheque_date",
  "transaction_ref",
  "payment_provider",
  "gateway_payment_id",
  "gateway_receipt",
  "remarks",
  "source",
  "source_receipt_no",
  "recorded_by",
];

const ORDER_INDEX = new Map(FIELD_ORDER.map((f, i) => [f, i]));

/** Drop the plumbing columns and sort what is left into reading order. */
export function visibleFields(columns: Iterable<string>): string[] {
  return Array.from(columns)
    .filter((c) => !HIDDEN_FIELDS.has(c))
    .sort((a, b) => {
      const ai = ORDER_INDEX.get(a) ?? Number.MAX_SAFE_INTEGER;
      const bi = ORDER_INDEX.get(b) ?? Number.MAX_SAFE_INTEGER;
      if (ai !== bi) return ai - bi;
      return a.localeCompare(b);
    });
}

export interface RequestSubject {
  student: string | null;
  feeHead: string | null;
  session: string | null;
}

/**
 * Who and what this request is about — the header line that was missing.
 *
 * Reads the proposed row first (an insert has no target row at all), then the
 * snapshot, then the live row, so every action type resolves to something.
 */
export function describeSubject(
  sources: Array<Record<string, unknown> | null | undefined>,
  labels: EntityLabels = {}
): RequestSubject {
  const pick = (column: string): string | null => {
    for (const source of sources) {
      const value = source?.[column];
      if (isUuid(value)) return labels[value] ?? UNRESOLVED_LABEL;
    }
    return null;
  };
  return {
    student: pick("student_id"),
    feeHead: pick("fee_structure_id"),
    session: pick("academic_year_id"),
  };
}
