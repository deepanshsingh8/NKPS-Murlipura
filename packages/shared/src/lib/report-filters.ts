/**
 * Report filter schema — one definition shared by the builder form and the API.
 *
 * The client posts this shape and the server parses the same schema, so a
 * filter cannot exist in the UI without the query understanding it (or the
 * reverse, which is how report builders quietly start ignoring inputs).
 *
 * Two deliberate departures from the old ERP's screen:
 *
 *  • `session_id` is REQUIRED and class is not. The old screen forced a class
 *    and let the session default to "current". Ours inverts it, because every
 *    row's class, roll number, status, house and transport are session-scoped:
 *    the session is the one filter that must be present for the output to mean
 *    anything, and a whole-school list is a normal request.
 *
 *  • Status is a multi-select over our five-value enum, not a single
 *    All/Active/Deactive dropdown.
 *
 * Tri-states ("both" | "yes" | "no") exist because a boolean column here has
 * three real answers: yes, no, and don't-filter. A plain boolean would make
 * "don't care" indistinguishable from "false".
 */

import { z } from "zod";

/** Tri-state filter over a nullable boolean column. */
export const triStateSchema = z.enum(["both", "yes", "no"]).default("both");
export type TriState = z.infer<typeof triStateSchema>;

export const sortDirSchema = z.enum(["asc", "desc"]).default("asc");
export type SortDir = z.infer<typeof sortDirSchema>;

/** Matches student_enrollments.status. */
export const ENROLLMENT_STATUSES = [
  "active",
  "passed",
  "failed",
  "terminated",
  "exited",
] as const;

export type EnrollmentStatusValue = (typeof ENROLLMENT_STATUSES)[number];

const uuid = z.string().uuid();
/** Blank strings arrive from unset `<Select>`s; treat them as absent. */
const optionalUuid = z
  .union([uuid, z.literal("")])
  .optional()
  .transform((v) => (v ? v : undefined));
const optionalTrimmed = z
  .string()
  .trim()
  .max(120)
  .optional()
  .transform((v) => (v ? v : undefined));
/** ISO date (YYYY-MM-DD) or absent. */
const optionalDate = z
  .union([z.string().regex(/^\d{4}-\d{2}-\d{2}$/), z.literal("")])
  .optional()
  .transform((v) => (v ? v : undefined));

export const reportFiltersSchema = z
  .object({
    // ── Scope ──
    session_id: uuid,
    class_ids: z.array(uuid).max(64).default([]),
    section: optionalTrimmed,
    stream_id: optionalUuid,
    subject_id: optionalUuid,
    house_id: optionalUuid,

    // ── Name & date ──
    name_contains: optionalTrimmed,
    father_name_contains: optionalTrimmed,
    admission_date_from: optionalDate,
    admission_date_to: optionalDate,
    dob_from: optionalDate,
    dob_to: optionalDate,

    // ── Demographics ──
    gender: optionalTrimmed,
    category: optionalTrimmed,
    religion: optionalTrimmed,
    minority_group: optionalTrimmed,
    area_type: optionalTrimmed,

    // ── Welfare / flags ──
    is_rte: triStateSchema,
    is_bpl: triStateSchema,
    is_ews: triStateSchema,
    is_cwsn: triStateSchema,
    is_staff_ward: triStateSchema,
    has_transport: triStateSchema,

    // ── Lifecycle ──
    // Default to active only: the overwhelmingly common report is "who is in
    // school right now", and silently including exited students would inflate
    // every count a school takes to a board.
    statuses: z
      .array(z.enum(ENROLLMENT_STATUSES))
      .min(1, "Pick at least one status")
      .max(ENROLLMENT_STATUSES.length)
      .default(["active"]),
    /** New = admitted within the session being reported on. */
    new_old: z.enum(["both", "new", "old"]).default("both"),

    // ── Derived, applied after the joins ──
    // These force the (expensive) fee / attendance joins to run even when no
    // column from them was ticked, because you cannot filter on a number you
    // did not compute. Both default to off so the common report stays cheap.
    /** "due" = balance ≥ ₹1 for the session. Sub-rupee remainders are settled. */
    fee_status: z.enum(["all", "due", "clear"]).default("all"),
    /** Keep only students below this attendance percentage. */
    attendance_below: z
      .union([z.number(), z.literal("")])
      .optional()
      .transform((v) => (typeof v === "number" && Number.isFinite(v) ? v : undefined))
      .pipe(z.number().min(0).max(100).optional()),

    // ── Output ──
    fields: z.array(z.string().max(64)).max(200).default([]),
    sort_by: optionalTrimmed,
    sort_dir: sortDirSchema,
    then_by: optionalTrimmed,
    then_dir: sortDirSchema,
  })
  // Reversed ranges return zero rows and read as "the report is broken" rather
  // than "your dates are backwards", so they are rejected with the field named.
  .refine(
    (v) => !v.admission_date_from || !v.admission_date_to || v.admission_date_from <= v.admission_date_to,
    { message: "Admission date 'from' is after 'to'", path: ["admission_date_to"] }
  )
  .refine((v) => !v.dob_from || !v.dob_to || v.dob_from <= v.dob_to, {
    message: "Date of birth 'from' is after 'to'",
    path: ["dob_to"],
  })
  .refine((v) => !v.then_by || v.then_by !== v.sort_by, {
    message: "Then By must differ from Sort By",
    path: ["then_by"],
  });

export type ReportFilters = z.infer<typeof reportFiltersSchema>;
/** Pre-parse shape — what the form holds and the client posts. */
export type ReportFiltersInput = z.input<typeof reportFiltersSchema>;

/** Preview request: filters plus paging. Export uses the filters alone. */
export const reportRunSchema = z.object({
  filters: reportFiltersSchema,
  page: z.number().int().min(1).default(1),
  // Capped: the preview is for eyeballing shape before exporting, and a
  // 5000-row JSON payload defeats the point of having an export.
  page_size: z.number().int().min(1).max(200).default(50),
});

export type ReportRunRequest = z.infer<typeof reportRunSchema>;

export const REPORT_EXPORT_FORMATS = ["csv", "xlsx", "pdf"] as const;
export type ReportExportFormat = (typeof REPORT_EXPORT_FORMATS)[number];

/**
 * Blank filter set for a session. `fields` starts empty — the always-on
 * S.No. and Student Name are added by resolveFields(), so an untouched form
 * still produces a valid two-column report rather than an error.
 */
export function emptyReportFilters(sessionId: string): ReportFiltersInput {
  return {
    session_id: sessionId,
    class_ids: [],
    statuses: ["active"],
    new_old: "both",
    is_rte: "both",
    is_bpl: "both",
    is_ews: "both",
    is_cwsn: "both",
    is_staff_ward: "both",
    has_transport: "both",
    fee_status: "all",
    fields: [],
    sort_dir: "asc",
    then_dir: "asc",
  };
}

/**
 * How many filters are actually narrowing the result, for the "N filters
 * active" badge. Session is excluded: it is always set, so counting it would
 * mean the badge never reads zero.
 */
export function countActiveFilters(f: ReportFilters): number {
  let n = 0;
  if (f.class_ids.length) n += 1;
  for (const v of [
    f.section, f.stream_id, f.subject_id, f.house_id,
    f.name_contains, f.father_name_contains,
    f.admission_date_from, f.admission_date_to, f.dob_from, f.dob_to,
    f.gender, f.category, f.religion, f.minority_group, f.area_type,
  ]) {
    if (v) n += 1;
  }
  for (const v of [
    f.is_rte, f.is_bpl, f.is_ews, f.is_cwsn, f.is_staff_ward, f.has_transport,
  ]) {
    if (v !== "both") n += 1;
  }
  if (f.new_old !== "both") n += 1;
  if (f.fee_status !== "all") n += 1;
  if (f.attendance_below !== undefined) n += 1;
  // Only counts once the caller has moved off the default.
  if (!(f.statuses.length === 1 && f.statuses[0] === "active")) n += 1;
  return n;
}
