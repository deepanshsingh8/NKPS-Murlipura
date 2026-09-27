/**
 * Report field registry — the single source of truth for the Custom Report
 * Builder's columns.
 *
 * One array drives all of it: the checkbox picker, the Sort By / Then By
 * dropdowns, the CSV headers, the XLSX headers and the PDF columns. They
 * cannot drift from each other because there is nothing to drift *between*.
 * This is the same discipline `student-template.ts` applies to the student
 * form, bulk sheet and per-student export — and this module is built on top of
 * that registry rather than beside it, so a field added there appears in the
 * report builder for free.
 *
 * Two things every field must declare:
 *
 *  • `columns` — the database columns it reads. The query projects the union of
 *    the selected fields' columns and nothing else. That is a security control,
 *    not an optimisation: a report of "Name + Class" must not pull Aadhaar
 *    numbers out of Postgres, where they could be logged, cached or leaked by
 *    a later bug.
 *
 *  • `resolve` — a total function from a row to a printable value. It is called
 *    once per cell, must never throw, and must tolerate every join being null:
 *    a student with no enrollment, no house, no bus stop and no result is a
 *    normal row, not an error.
 */

import {
  STUDENT_TEMPLATE_FIELDS,
  type StudentTemplateField,
  formatFieldValue,
  indianNationalFromNationality,
} from "./student-template";
import { REPORT_SENSITIVE_KEYS } from "./pii-fields";

// ── Types ───────────────────────────────────────────────────────────────────

/** Which part of the joined row a field reads from. */
export type ReportSource =
  | "students"
  | "enrollment"
  | "class"
  | "house"
  | "transport"
  | "session"
  | "subjects"
  | "fees"
  | "attendance"
  | "results"
  | "derived"
  | "blank";

/**
 * Picker groups, in display order. Deliberately different from the student
 * template's two "profile" sections: a person building a contact sheet thinks
 * in terms of "Contact", not "General Profile particular 7".
 */
export const REPORT_GROUPS = [
  "Identity",
  "Family",
  "Contact",
  "Address",
  "Category & Welfare",
  "Enrolment",
  "Transport",
  "Previous School",
  "Admissions",
  "Fees",
  "Attendance",
  "Results",
  "Academics",
  "Print",
] as const;

export type ReportGroup = (typeof REPORT_GROUPS)[number];

/** The shape the query hands to `resolve`. Every join is nullable. */
export interface ReportRow {
  student: Record<string, unknown>;
  /** The enrollment for the *selected session* — never a "representative" one. */
  enrollment: Record<string, unknown> | null;
  klass: { name: string; section: string | null } | null;
  stream: { name: string } | null;
  house: { name: string; code: string | null } | null;
  busStop: { name: string } | null;
  session: { name: string; start_date: string; end_date: string } | null;
  /** Subject names for this student in this session, already ordered. */
  subjects: string[] | null;
  /** Fee position for the session. Computed with the SAME pure functions the
   *  Dues screen uses (lib/fees.ts), just fed from batched data — so these
   *  numbers cannot drift from the ones there. */
  fees: {
    billed: number;
    paid: number;
    balance: number;
    waived: number;
    lastPaymentDate: string | null;
    lastReceiptNo: string | null;
    paymentCount: number;
  } | null;
  /** Attendance tallied over the session's date range. */
  attendance: {
    present: number;
    absent: number;
    late: number;
    halfDay: number;
    total: number;
    /** Null when nothing was ever marked — a literal 0% would read as
     *  "never attended once", which is a different and much worse claim. */
    percent: number | null;
  } | null;
  /** Marks aggregated across every exam recorded for the session. */
  results: {
    obtained: number;
    max: number;
    percent: number | null;
    subjectCount: number;
    examCount: number;
  } | null;
  /** 1-based position in the final, sorted result set. */
  serial: number;
}

export interface ReportField {
  /** Stable id. Appears in URLs and saved presets, so renaming one breaks
   *  every saved report — treat these as permanent. */
  key: string;
  label: string;
  group: ReportGroup;
  source: ReportSource;
  /** Database columns this field reads, qualified by source. */
  columns?: string[];
  /** Eligible for Sort By / Then By. Blanks and multi-value fields are not. */
  sortable?: boolean;
  /** Always selected and not untickable (Serial No + Student Name). */
  always?: boolean;
  /** Numeric — right-aligned in print, and sorted numerically not lexically. */
  numeric?: boolean;
  /** Carries personal data. Stripped server-side for non-admin callers. */
  sensitive?: boolean;
  /** Column width hint, in characters. */
  width?: number;
  resolve: (row: ReportRow) => string | number | null;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function text(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}

/**
 * Split a single `full_name` into first / middle / last.
 *
 * The old ERP stored three columns; we store one, so these are derived and
 * therefore lossy — "Ram Kumar Singh Yadav" gives middle "Kumar Singh". That
 * matches how the old reports printed it and is the reason we do NOT store the
 * split: it would immediately disagree with `full_name` on the first rename.
 */
function nameParts(full: unknown): { first: string; middle: string; last: string } {
  const parts = String(full ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { first: "", middle: "", last: "" };
  if (parts.length === 1) return { first: parts[0], middle: "", last: "" };
  return {
    first: parts[0],
    middle: parts.slice(1, -1).join(" "),
    last: parts[parts.length - 1],
  };
}

/** Which picker group a student-template field belongs to. */
const TEMPLATE_GROUP: Record<string, ReportGroup> = {
  admission_no: "Identity", full_name: "Identity", gender: "Identity",
  date_of_birth: "Identity", name_as_per_aadhar: "Identity",
  aadhar_number: "Identity", jan_aadhar_number: "Identity",
  pen_number: "Identity", apaar_number: "Identity",
  cbse_registration_no: "Identity", nic_number: "Identity",
  blood_group: "Identity", place_of_birth: "Identity",
  height_cm: "Identity", weight_kg: "Identity",

  father_name: "Family", father_salutation: "Family", father_occupation: "Family",
  father_qualification: "Family", father_annual_income: "Family",
  mother_name: "Family", mother_salutation: "Family", mother_occupation: "Family",
  mother_qualification: "Family", mother_annual_income: "Family",
  guardian_name: "Family", guardian_relation: "Family",
  parent_highest_education: "Family",

  phone: "Contact", email: "Contact", father_mobile: "Contact",
  mother_mobile: "Contact", guardian_mobile: "Contact",
  sms_mobile_source: "Contact",

  address: "Address", present_pincode: "Address", permanent_address: "Address",
  permanent_pincode: "Address", mailing_address: "Address",
  office_address: "Address", mother_office_address: "Address",
  district: "Address", state: "Address", area_type: "Address",
  distance_band: "Address",

  category: "Category & Welfare", caste: "Category & Welfare",
  religion: "Category & Welfare", minority_group: "Category & Welfare",
  mother_tongue: "Category & Welfare", is_bpl: "Category & Welfare",
  is_ews: "Category & Welfare", is_rte: "Category & Welfare",
  is_cwsn: "Category & Welfare", cwsn_impairment_type: "Category & Welfare",
  is_staff_ward: "Category & Welfare",

  admission_date: "Enrolment", admission_class: "Enrolment",
  medium_of_instruction: "Enrolment", participates_ncc: "Enrolment",
  participates_nss: "Enrolment", participates_scouts: "Enrolment",
  participates_competitions: "Enrolment", last_session_attendance: "Enrolment",

  registration_no: "Admissions", registration_date: "Admissions",
  form_no: "Admissions", admission_confirm_date: "Admissions",
  counsellor_name: "Admissions", counsellor_remark: "Admissions",
  staff_reference: "Admissions", student_type: "Admissions",
  caution_money_receipt_no: "Admissions",
  caution_money_receipt_date: "Admissions",
  caution_money_amount: "Admissions",
};

/**
 * Fields carrying personal data that a non-admin should not be able to export.
 * Enforced server-side — hiding them in the picker is presentation only.
 *
 * The list itself lives in `pii-fields.ts`, alongside the one the generic
 * exports use and a note on where the two disagree.
 */
const SENSITIVE_KEYS = REPORT_SENSITIVE_KEYS;

// ── Template-backed fields ──────────────────────────────────────────────────

/**
 * The 88 `students` columns the template registry already describes, mapped
 * into report fields. Non-`students` sources (class_name, section, stream,
 * roll_number, subjects) are excluded here and re-declared below against the
 * session's enrollment, because the template's versions describe "the
 * student's current class" and a report needs "the class in the chosen
 * session" — a distinction that silently corrupts every historical report if
 * you get it wrong.
 */
const TEMPLATE_FIELDS: ReportField[] = STUDENT_TEMPLATE_FIELDS.filter(
  (f) => f.source === "students"
).map((f: StudentTemplateField) => ({
  key: f.key,
  label: f.exportLabel ?? f.label,
  group: TEMPLATE_GROUP[f.key] ?? "Enrolment",
  source: "students" as const,
  columns: [f.key],
  sortable: true,
  numeric: f.kind === "number" || f.kind === "integer",
  sensitive: SENSITIVE_KEYS.has(f.key),
  width: f.colWidth,
  resolve: (row: ReportRow) => formatFieldValue(f, row.student[f.key]) || null,
}));

// ── Derived, joined and print-only fields ───────────────────────────────────

const EXTRA_FIELDS: ReportField[] = [
  // ── Identity ──
  {
    // Not the admission number: a 1-based counter over the *sorted* result
    // set, which is what "S.No." means on a printed sheet.
    key: "serial",
    label: "S. No.",
    group: "Identity",
    source: "derived",
    always: true,
    numeric: true,
    width: 6,
    resolve: (row) => row.serial,
  },
  {
    key: "student_name",
    label: "Student Name",
    group: "Identity",
    source: "students",
    columns: ["full_name"],
    always: true,
    sortable: true,
    width: 24,
    resolve: (row) => text(row.student.full_name),
  },
  {
    key: "first_name",
    label: "First Name",
    group: "Identity",
    source: "derived",
    columns: ["full_name"],
    sortable: true,
    width: 14,
    resolve: (row) => nameParts(row.student.full_name).first || null,
  },
  {
    key: "middle_name",
    label: "Middle Name",
    group: "Identity",
    source: "derived",
    columns: ["full_name"],
    width: 14,
    resolve: (row) => nameParts(row.student.full_name).middle || null,
  },
  {
    key: "last_name",
    label: "Last Name",
    group: "Identity",
    source: "derived",
    columns: ["full_name"],
    sortable: true,
    width: 14,
    resolve: (row) => nameParts(row.student.full_name).last || null,
  },
  {
    key: "indian_national",
    label: "Indian National",
    group: "Identity",
    source: "derived",
    columns: ["nationality"],
    width: 12,
    resolve: (row) => {
      const v = indianNationalFromNationality(
        (row.student.nationality as string | null) ?? null
      );
      return v === undefined ? null : v ? "YES" : "NO";
    },
  },
  {
    key: "nationality",
    label: "Nationality",
    group: "Identity",
    source: "students",
    columns: ["nationality"],
    sortable: true,
    width: 12,
    resolve: (row) => text(row.student.nationality),
  },
  {
    key: "photo_url",
    label: "Photo",
    group: "Identity",
    source: "students",
    columns: ["photo_url"],
    sensitive: true,
    width: 30,
    resolve: (row) => text(row.student.photo_url),
  },

  // ── Enrolment (session-scoped — see the module header) ──
  {
    key: "class_name",
    label: "Class",
    group: "Enrolment",
    source: "class",
    columns: ["name"],
    sortable: true,
    width: 10,
    resolve: (row) => text(row.klass?.name),
  },
  {
    key: "section",
    label: "Section",
    group: "Enrolment",
    source: "class",
    columns: ["section"],
    sortable: true,
    width: 8,
    resolve: (row) => text(row.klass?.section),
  },
  {
    key: "class_section",
    label: "Class & Section",
    group: "Enrolment",
    source: "class",
    columns: ["name", "section"],
    sortable: true,
    width: 14,
    resolve: (row) => {
      const n = text(row.klass?.name);
      if (!n) return null;
      const s = text(row.klass?.section);
      return s ? `${n}-${s}` : n;
    },
  },
  {
    key: "stream_name",
    label: "Stream",
    group: "Enrolment",
    source: "enrollment",
    columns: ["stream_id"],
    sortable: true,
    width: 12,
    resolve: (row) => text(row.stream?.name),
  },
  {
    key: "roll_number",
    label: "Roll No",
    group: "Enrolment",
    source: "enrollment",
    columns: ["roll_number"],
    sortable: true,
    numeric: true,
    width: 8,
    resolve: (row) => (row.enrollment?.roll_number as number | null) ?? null,
  },
  {
    key: "session_name",
    label: "Session",
    group: "Enrolment",
    source: "session",
    sortable: true,
    width: 12,
    resolve: (row) => text(row.session?.name),
  },
  {
    key: "enrollment_date",
    label: "Date of Admission in Class",
    group: "Enrolment",
    source: "enrollment",
    columns: ["enrollment_date"],
    sortable: true,
    width: 18,
    resolve: (row) => text(row.enrollment?.enrollment_date),
  },
  {
    key: "enrollment_status",
    label: "Student Status",
    group: "Enrolment",
    source: "enrollment",
    columns: ["status"],
    sortable: true,
    width: 12,
    resolve: (row) => {
      const s = text(row.enrollment?.status);
      return s ? s.charAt(0).toUpperCase() + s.slice(1) : null;
    },
  },
  {
    key: "status_reason",
    label: "Status Reason",
    group: "Enrolment",
    source: "enrollment",
    columns: ["status_reason"],
    width: 28,
    resolve: (row) => text(row.enrollment?.status_reason),
  },
  {
    key: "status_changed_at",
    label: "Date of Status Change",
    group: "Enrolment",
    source: "enrollment",
    columns: ["status_changed_at"],
    sortable: true,
    width: 18,
    resolve: (row) => {
      const v = text(row.enrollment?.status_changed_at);
      return v ? v.slice(0, 10) : null;
    },
  },
  {
    key: "house_name",
    label: "House",
    group: "Enrolment",
    source: "house",
    columns: ["house_id"],
    sortable: true,
    width: 14,
    resolve: (row) => text(row.house?.name),
  },
  {
    key: "house_code",
    label: "House Code",
    group: "Enrolment",
    source: "house",
    columns: ["house_id"],
    sortable: true,
    width: 8,
    resolve: (row) => text(row.house?.code),
  },
  {
    // The old ERP's "OldNew". Derived, never stored: a student is New if they
    // were admitted inside the session being reported on. `student_type` (a
    // real column) is the manual override for when that derivation is wrong.
    key: "old_new",
    label: "New / Old",
    group: "Enrolment",
    source: "derived",
    columns: ["admission_date", "student_type"],
    sortable: true,
    width: 10,
    resolve: (row) => {
      const override = text(row.student.student_type);
      if (override) return override.charAt(0).toUpperCase() + override.slice(1);
      const admitted = text(row.student.admission_date);
      const s = row.session;
      if (!admitted || !s) return null;
      return admitted >= s.start_date && admitted <= s.end_date ? "New" : "Old";
    },
  },
  {
    key: "subjects",
    label: "Subjects",
    group: "Enrolment",
    source: "subjects",
    width: 30,
    resolve: (row) => (row.subjects?.length ? row.subjects.join(", ") : null),
  },

  // ── Transport ──
  {
    key: "has_transport",
    label: "Transport Student",
    group: "Transport",
    source: "enrollment",
    columns: ["has_transport"],
    sortable: true,
    width: 12,
    resolve: (row) => (row.enrollment?.has_transport ? "YES" : "NO"),
  },
  {
    key: "day_scholar",
    // Source is `enrollment`, not `derived`, even though the value is computed:
    // `source` says which table the `columns` come from, and has_transport
    // lives on the enrollment. Calling it derived would project it off
    // `students`, where it does not exist.
    label: "Day Scholar",
    group: "Transport",
    source: "enrollment",
    columns: ["has_transport"],
    width: 12,
    resolve: (row) => (row.enrollment?.has_transport ? "NO" : "YES"),
  },
  {
    key: "bus_stop_name",
    label: "Bus Stop",
    group: "Transport",
    source: "transport",
    columns: ["bus_stop_id"],
    sortable: true,
    width: 18,
    resolve: (row) => text(row.busStop?.name),
  },
  {
    key: "transport_direction",
    label: "Transport Direction",
    group: "Transport",
    source: "enrollment",
    columns: ["transport_direction"],
    width: 14,
    resolve: (row) => text(row.enrollment?.transport_direction),
  },

  // ── Fees ──
  // Labelled "(Session)" deliberately. These answer "what was billed and paid
  // for THIS academic year", because that is the only question a session-scoped
  // report can answer coherently. The Dues screen answers a different one —
  // what a family owes overall, right now, across every year — and the two
  // figures will legitimately differ for a student with carried-over arrears.
  // Unlabelled columns would invite someone to treat them as the same number.
  //
  // Money is `numeric` in Postgres, so these arrive as numbers already rounded
  // by the maths in lib/fees.ts. They are NOT re-rounded or formatted here:
  // a report that prints ₹ or thousands separators cannot be summed in Excel,
  // which is the first thing anyone does with a fee sheet.
  {
    key: "fee_billed",
    label: "Fees Billed (Session)",
    group: "Fees",
    source: "fees",
    sortable: true,
    numeric: true,
    width: 12,
    resolve: (row) => row.fees?.billed ?? null,
  },
  {
    key: "fee_paid",
    label: "Fees Paid (Session)",
    group: "Fees",
    source: "fees",
    sortable: true,
    numeric: true,
    width: 12,
    resolve: (row) => row.fees?.paid ?? null,
  },
  {
    key: "fee_balance",
    label: "Balance Due (Session)",
    group: "Fees",
    source: "fees",
    sortable: true,
    numeric: true,
    width: 12,
    resolve: (row) => row.fees?.balance ?? null,
  },
  {
    key: "fee_waived",
    label: "Concession",
    group: "Fees",
    source: "fees",
    sortable: true,
    numeric: true,
    width: 12,
    resolve: (row) => row.fees?.waived ?? null,
  },
  {
    key: "fee_status",
    label: "Fee Status",
    group: "Fees",
    source: "fees",
    sortable: true,
    width: 10,
    // Sub-rupee remainders count as settled, matching the dues gate — a
    // student must not read as "Due" over a rounding artefact.
    resolve: (row) =>
      row.fees === null ? null : row.fees.balance >= 1 ? "Due" : "Clear",
  },
  {
    key: "fee_last_payment_date",
    label: "Last Payment Date",
    group: "Fees",
    source: "fees",
    sortable: true,
    width: 16,
    resolve: (row) => row.fees?.lastPaymentDate ?? null,
  },
  {
    key: "fee_last_receipt_no",
    label: "Last Receipt No",
    group: "Fees",
    source: "fees",
    sortable: true,
    width: 14,
    resolve: (row) => row.fees?.lastReceiptNo ?? null,
  },
  {
    key: "fee_payment_count",
    label: "Payments",
    group: "Fees",
    source: "fees",
    sortable: true,
    numeric: true,
    width: 9,
    resolve: (row) => row.fees?.paymentCount ?? null,
  },

  // ── Attendance ──
  {
    key: "attendance_present",
    label: "Days Present",
    group: "Attendance",
    source: "attendance",
    sortable: true,
    numeric: true,
    width: 11,
    resolve: (row) => row.attendance?.present ?? null,
  },
  {
    key: "attendance_absent",
    label: "Days Absent",
    group: "Attendance",
    source: "attendance",
    sortable: true,
    numeric: true,
    width: 11,
    resolve: (row) => row.attendance?.absent ?? null,
  },
  {
    key: "attendance_late",
    label: "Days Late",
    group: "Attendance",
    source: "attendance",
    sortable: true,
    numeric: true,
    width: 10,
    resolve: (row) => row.attendance?.late ?? null,
  },
  {
    key: "attendance_half_day",
    label: "Half Days",
    group: "Attendance",
    source: "attendance",
    sortable: true,
    numeric: true,
    width: 10,
    resolve: (row) => row.attendance?.halfDay ?? null,
  },
  {
    key: "attendance_total",
    label: "Days Marked",
    group: "Attendance",
    source: "attendance",
    sortable: true,
    numeric: true,
    width: 11,
    resolve: (row) => row.attendance?.total ?? null,
  },
  {
    key: "attendance_percent",
    label: "Attendance %",
    group: "Attendance",
    source: "attendance",
    sortable: true,
    numeric: true,
    width: 12,
    resolve: (row) => row.attendance?.percent ?? null,
  },

  // ── Results ──
  // A whole-session aggregate across every exam recorded, which is what a
  // list-style report can honestly show. The authoritative per-student
  // outcome — pass/fail, grades, rank, supplementary — comes from
  // computeFinalResult() and lives on the report card and green sheet, which
  // is where anyone deciding a student's fate should be looking.
  {
    key: "result_obtained",
    label: "Marks Obtained",
    group: "Results",
    source: "results",
    sortable: true,
    numeric: true,
    width: 13,
    resolve: (row) => row.results?.obtained ?? null,
  },
  {
    key: "result_max",
    label: "Maximum Marks",
    group: "Results",
    source: "results",
    sortable: true,
    numeric: true,
    width: 13,
    resolve: (row) => row.results?.max ?? null,
  },
  {
    key: "result_percent",
    label: "Percentage",
    group: "Results",
    source: "results",
    sortable: true,
    numeric: true,
    width: 11,
    resolve: (row) => row.results?.percent ?? null,
  },
  {
    key: "result_subject_count",
    label: "Subjects Graded",
    group: "Results",
    source: "results",
    sortable: true,
    numeric: true,
    width: 13,
    resolve: (row) => row.results?.subjectCount ?? null,
  },
  {
    key: "result_exam_count",
    label: "Exams Recorded",
    group: "Results",
    source: "results",
    sortable: true,
    numeric: true,
    width: 13,
    resolve: (row) => row.results?.examCount ?? null,
  },

  // ── Print-only ──
  // Empty columns so a printed sheet has room to write in by hand. The old
  // ERP shipped exactly three and they are used constantly — attendance ticks
  // at a meeting, signatures on a fee collection round.
  ...[1, 2, 3].map((n) => ({
    key: `blank_${n}`,
    label: `Blank-${n}`,
    group: "Print" as ReportGroup,
    source: "blank" as const,
    width: 14,
    resolve: () => null,
  })),
];

// ── The registry ────────────────────────────────────────────────────────────

export const REPORT_FIELDS: readonly ReportField[] = [
  ...EXTRA_FIELDS.filter((f) => f.always),
  // `full_name` is dropped: `student_name` above is the same column, but
  // always-on. `admission_no` stays — it is a normal, untickable-optional
  // field (the old ERP's "SR No" / "Admission No").
  ...TEMPLATE_FIELDS.filter((f) => f.key !== "full_name"),
  ...EXTRA_FIELDS.filter((f) => !f.always),
].sort((a, b) => {
  const ga = REPORT_GROUPS.indexOf(a.group);
  const gb = REPORT_GROUPS.indexOf(b.group);
  if (ga !== gb) return ga - gb;
  // Always-on fields lead their group; the rest keep declaration order.
  return (b.always ? 1 : 0) - (a.always ? 1 : 0);
});

const FIELD_BY_KEY: ReadonlyMap<string, ReportField> = new Map(
  REPORT_FIELDS.map((f) => [f.key, f])
);

export function getReportField(key: string): ReportField | undefined {
  return FIELD_BY_KEY.get(key);
}

/** Keys that are always in the output whether or not the caller asked. */
export const ALWAYS_FIELD_KEYS: readonly string[] = REPORT_FIELDS.filter(
  (f) => f.always
).map((f) => f.key);

/** Fields eligible for Sort By / Then By, in picker order. */
export const SORTABLE_FIELDS: readonly ReportField[] = REPORT_FIELDS.filter(
  (f) => f.sortable
);

/**
 * Resolve caller-supplied keys into fields: drops unknown keys, prepends the
 * always-on ones, de-duplicates, and preserves the caller's column order
 * otherwise. Unknown keys are dropped rather than rejected so an old saved
 * preset still runs after a field is retired.
 */
export function resolveFields(keys: readonly string[]): ReportField[] {
  const seen = new Set<string>();
  const out: ReportField[] = [];
  for (const key of [...ALWAYS_FIELD_KEYS, ...keys]) {
    if (seen.has(key)) continue;
    const field = FIELD_BY_KEY.get(key);
    if (!field) continue;
    seen.add(key);
    out.push(field);
  }
  return out;
}

/**
 * `resolveFields` for callers that need to know what was thrown away.
 *
 * The silent drop above is right for saved presets — a retired field should
 * not break a report someone saved last year. It is wrong for a language
 * model, which would receive a quietly smaller table and describe columns it
 * never got. This returns the same fields plus the unknown keys and a
 * suggestion for each, so the caller can hand the model something to correct.
 *
 * Suggestions are matched on the key and on the label's words, so a model that
 * guesses "father_name" or "Father's Name" both land on `father_name`.
 */
export function partitionFieldKeys(keys: readonly string[]): {
  resolved: ReportField[];
  unknown: string[];
  suggestions: Record<string, string[]>;
} {
  const resolved = resolveFields(keys);
  const unknown = keys.filter((k) => !FIELD_BY_KEY.has(k));
  const suggestions: Record<string, string[]> = {};

  for (const bad of unknown) {
    const needle = normalizeForMatch(bad);
    if (!needle) continue;
    const scored: { key: string; score: number }[] = [];
    for (const field of REPORT_FIELDS) {
      const score = Math.max(
        matchScore(needle, normalizeForMatch(field.key)),
        matchScore(needle, normalizeForMatch(field.label))
      );
      if (score > 0) scored.push({ key: field.key, score });
    }
    scored.sort((a, b) => b.score - a.score || a.key.localeCompare(b.key));
    const top = scored.slice(0, 3).map((s) => s.key);
    if (top.length > 0) suggestions[bad] = top;
  }

  return { resolved, unknown, suggestions };
}

function normalizeForMatch(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/**
 * Cheap similarity: shared word count, then containment, then shared prefix.
 * Deliberately not an edit-distance library — this only has to order 135
 * candidates well enough to put the right one in a three-item list.
 */
function matchScore(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1000;

  const aWords = new Set(a.split(" "));
  const bWords = b.split(" ");
  let shared = 0;
  for (const word of bWords) if (aWords.has(word)) shared += 1;

  let score = shared * 100;
  if (b.includes(a) || a.includes(b)) score += 50;

  let prefix = 0;
  while (prefix < a.length && prefix < b.length && a[prefix] === b[prefix]) prefix += 1;
  score += prefix;

  return score;
}

/**
 * The field catalogue as a model reads it, grouped and role-filtered.
 *
 * Returned as data rather than a rendered string so the caller decides how to
 * serialise it. It belongs in a cached prompt prefix: it is static per role,
 * so paying for it once per role beats a lookup tool that costs a round trip
 * on nearly every conversation.
 */
export function describeFieldCatalog(
  isAdmin: boolean
): { group: ReportGroup; fields: { key: string; label: string }[] }[] {
  const visible = applyFieldVisibility(REPORT_FIELDS, isAdmin);
  const byGroup = new Map<ReportGroup, { key: string; label: string }[]>();

  for (const field of visible) {
    const bucket = byGroup.get(field.group) ?? [];
    bucket.push({ key: field.key, label: field.label });
    byGroup.set(field.group, bucket);
  }

  // REPORT_GROUPS order, skipping groups no field actually lands in — two of
  // them ("Previous School", "Academics") are declared but currently empty.
  return REPORT_GROUPS.filter((g) => byGroup.has(g)).map((group) => ({
    group,
    fields: byGroup.get(group)!,
  }));
}

/** Strip fields the caller isn't allowed to export. Admins keep everything. */
export function applyFieldVisibility(
  fields: readonly ReportField[],
  isAdmin: boolean
): ReportField[] {
  return isAdmin ? [...fields] : fields.filter((f) => !f.sensitive);
}

/**
 * The `students` columns a field selection needs. Always includes `id` (row
 * identity) and the always-on fields' columns. The query projects exactly
 * this — see the module header on why that is a security control.
 */
export function studentColumnsFor(fields: readonly ReportField[]): string[] {
  const cols = new Set<string>(["id"]);
  for (const f of fields) {
    if (f.source === "students" || f.source === "derived") {
      for (const c of f.columns ?? []) cols.add(c);
    }
  }
  return [...cols];
}

/** The `student_enrollments` columns a field selection needs. */
export function enrollmentColumnsFor(fields: readonly ReportField[]): string[] {
  const cols = new Set<string>(["id", "student_id", "class_id", "academic_year_id"]);
  for (const f of fields) {
    if (f.source === "enrollment" || f.source === "house" || f.source === "transport") {
      for (const c of f.columns ?? []) cols.add(c);
    }
  }
  return [...cols];
}

/** True when the selection needs the per-student subject join at all. */
export function needsSubjects(fields: readonly ReportField[]): boolean {
  return fields.some((f) => f.source === "subjects");
}

/**
 * Which of the expensive optional joins this selection actually needs.
 *
 * Each of these costs extra queries and a per-student computation, so they are
 * skipped entirely unless a selected field reads from them. A contact sheet
 * must not pay for the fee maths.
 */
export function needsJoins(fields: readonly ReportField[]): {
  subjects: boolean;
  fees: boolean;
  attendance: boolean;
  results: boolean;
} {
  return {
    subjects: fields.some((f) => f.source === "subjects"),
    fees: fields.some((f) => f.source === "fees"),
    attendance: fields.some((f) => f.source === "attendance"),
    results: fields.some((f) => f.source === "results"),
  };
}

/**
 * Field keys that make up each themed report, used by the `?focus=` entry
 * points on /reports. They are a starting selection, not a restriction — the
 * picker stays fully open once the page loads, so "Fee Report" is a shortcut
 * into the one builder rather than a separate, weaker screen.
 */
export const REPORT_FOCUSES = {
  fees: {
    label: "Fee Report",
    fields: [
      "admission_no", "class_section", "father_name", "father_mobile",
      "fee_billed", "fee_paid", "fee_waived", "fee_balance", "fee_status",
      "fee_last_payment_date",
    ],
    sort_by: "fee_balance",
    sort_dir: "desc" as const,
  },
  attendance: {
    label: "Attendance Report",
    fields: [
      "admission_no", "class_section", "roll_number",
      "attendance_present", "attendance_absent", "attendance_total",
      "attendance_percent",
    ],
    sort_by: "attendance_percent",
    sort_dir: "asc" as const,
  },
  results: {
    label: "Result Report",
    fields: [
      "admission_no", "class_section", "roll_number",
      "result_obtained", "result_max", "result_percent", "result_subject_count",
    ],
    sort_by: "result_percent",
    sort_dir: "desc" as const,
  },
} as const;

export type ReportFocus = keyof typeof REPORT_FOCUSES;

export function isReportFocus(v: unknown): v is ReportFocus {
  return typeof v === "string" && v in REPORT_FOCUSES;
}
