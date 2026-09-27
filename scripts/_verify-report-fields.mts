/**
 * Integrity checks for the report field registry.
 *
 *   npx tsx scripts/_verify-report-fields.mts
 *
 * There is no test runner in this repo, so this is the runnable equivalent:
 * it fails loudly (exit 1) on the five ways this can go wrong.
 *
 *  1. Duplicate keys — a saved preset would silently resolve to the wrong column.
 *  2. A `columns` entry that is not a real database column — the query would
 *     project a non-existent column and PostgREST would 400 the whole report.
 *  3. A `resolve` that throws on a sparse row — every join is nullable, and a
 *     student with no enrollment, house, stop or session is a normal row.
 *  4. Sort/always/sensitive invariants.
 *  5. A seeded preset in migration 093 naming a field key that does not exist.
 */

import { readFileSync } from "node:fs";
import {
  REPORT_FOCUSES,
  REPORT_FIELDS,
  REPORT_GROUPS,
  ALWAYS_FIELD_KEYS,
  SORTABLE_FIELDS,
  resolveFields,
  applyFieldVisibility,
  studentColumnsFor,
  enrollmentColumnsFor,
  type ReportRow,
} from "../packages/shared/src/lib/report-fields";
import { studentsInsertKeys } from "../packages/shared/src/lib/student-template";

const failures: string[] = [];
const fail = (msg: string) => failures.push(msg);

// ─── 1. Unique keys ─────────────────────────────────────────────────────────
const keys = REPORT_FIELDS.map((f) => f.key);
const dupes = [...new Set(keys.filter((k, i) => keys.indexOf(k) !== i))];
if (dupes.length) fail(`duplicate field keys: ${dupes.join(", ")}`);

// ─── 2. Columns exist ───────────────────────────────────────────────────────
// `students` columns the registry may legitimately read but which are not
// template fields (so not in studentsInsertKeys).
const EXTRA_STUDENT_COLUMNS = new Set([
  "id", "nationality", "photo_url", "is_active", "is_alumni",
  "alumni_passing_year", "admission_class", "created_at", "updated_at",
]);
const validStudentColumns = new Set([...studentsInsertKeys(), ...EXTRA_STUDENT_COLUMNS]);

const validEnrollmentColumns = new Set([
  "id", "student_id", "class_id", "academic_year_id", "stream_id",
  "roll_number", "roll_number_manual", "enrollment_date", "status",
  "status_reason", "status_changed_at", "status_changed_by", "house_id",
  "has_transport", "bus_stop_id", "bus_id", "transport_direction",
  "transport_fee_override", "pickup_address", "updated_at",
]);

for (const f of REPORT_FIELDS) {
  if (!REPORT_GROUPS.includes(f.group)) fail(`${f.key}: unknown group "${f.group}"`);

  if (f.source === "students" || f.source === "derived") {
    for (const c of f.columns ?? []) {
      if (!validStudentColumns.has(c)) fail(`${f.key}: "${c}" is not a students column`);
    }
  }
  if (f.source === "enrollment" || f.source === "house" || f.source === "transport") {
    for (const c of f.columns ?? []) {
      if (!validEnrollmentColumns.has(c)) {
        fail(`${f.key}: "${c}" is not a student_enrollments column`);
      }
    }
  }
  if (f.source === "blank" && f.sortable) fail(`${f.key}: blank columns cannot be sortable`);
}

// ─── 3. resolve() is total ──────────────────────────────────────────────────
const emptyRow: ReportRow = {
  student: {},
  enrollment: null,
  klass: null,
  stream: null,
  house: null,
  busStop: null,
  session: null,
  subjects: null,
  fees: null,
  attendance: null,
  results: null,
  serial: 1,
};

const fullRow: ReportRow = {
  student: {
    id: "s1", full_name: "Ram Kumar Singh Yadav", admission_no: "2351",
    father_name: "Mukesh Kumar", father_salutation: "shri", date_of_birth: "2010-11-12",
    gender: "male", nationality: "Indian", is_bpl: true, is_rte: false,
    admission_date: "2026-04-15", student_type: null, caution_money_amount: 1500,
    area_type: "rural", sms_mobile_source: "father", height_cm: 152.5,
  },
  enrollment: {
    id: "e1", student_id: "s1", roll_number: 27, status: "active",
    status_reason: null, status_changed_at: "2026-04-15T10:00:00Z",
    enrollment_date: "2026-04-15", has_transport: true,
    transport_direction: "both", house_id: "h1",
  },
  klass: { name: "XI-Science", section: "A" },
  stream: { name: "Science" },
  house: { name: "Red House", code: "RED" },
  busStop: { name: "Rajawas Chowk" },
  session: { name: "2026-2027", start_date: "2026-04-01", end_date: "2027-03-31" },
  subjects: ["Physics", "Chemistry", "Mathematics"],
  fees: {
    billed: 48000, paid: 30000, balance: 18000, waived: 2500,
    lastPaymentDate: "2026-07-04", lastReceiptNo: "R-1042", paymentCount: 3,
  },
  attendance: {
    present: 180, absent: 12, late: 4, halfDay: 4, total: 200, percent: 93,
  },
  results: {
    obtained: 412, max: 500, percent: 82.4, subjectCount: 5, examCount: 2,
  },
  serial: 1,
};

for (const row of [emptyRow, fullRow]) {
  const label = row === emptyRow ? "empty row" : "full row";
  for (const f of REPORT_FIELDS) {
    try {
      const v = f.resolve(row);
      if (v !== null && typeof v !== "string" && typeof v !== "number") {
        fail(`${f.key}: resolve returned ${typeof v} on ${label}`);
      }
    } catch (err) {
      fail(`${f.key}: resolve threw on ${label} — ${(err as Error).message}`);
    }
  }
}

// A student admitted inside the session is New; the same student reported on a
// later session is Old. This is the derivation the old ERP called "OldNew".
const oldNew = REPORT_FIELDS.find((f) => f.key === "old_new")!;
if (oldNew.resolve(fullRow) !== "New") fail("old_new: expected New for in-session admission");
const laterSession: ReportRow = {
  ...fullRow,
  session: { name: "2027-2028", start_date: "2027-04-01", end_date: "2028-03-31" },
};
if (oldNew.resolve(laterSession) !== "Old") fail("old_new: expected Old for a later session");

// ─── 4. Invariants ──────────────────────────────────────────────────────────
if (ALWAYS_FIELD_KEYS.length === 0) fail("no always-on fields — S.No./Name must be forced");

// Always-on fields survive an empty selection, and stay first.
const resolved = resolveFields([]);
if (resolved.length !== ALWAYS_FIELD_KEYS.length) {
  fail(`resolveFields([]) returned ${resolved.length}, expected the always-on set`);
}

// A caller asking for a duplicate, an unknown key and an always-on key gets a
// clean, de-duplicated list rather than an error.
const messy = resolveFields(["class_name", "class_name", "no_such_field", "student_name"]);
if (messy.filter((f) => f.key === "class_name").length !== 1) fail("resolveFields did not de-duplicate");
if (messy.some((f) => f.key === "no_such_field")) fail("resolveFields kept an unknown key");

// Non-admins lose the sensitive columns.
const all = resolveFields(REPORT_FIELDS.map((f) => f.key));
const restricted = applyFieldVisibility(all, false);
const sensitiveCount = all.filter((f) => f.sensitive).length;
if (sensitiveCount === 0) fail("no fields marked sensitive — the PII gate would be a no-op");
if (restricted.length !== all.length - sensitiveCount) fail("applyFieldVisibility dropped the wrong count");
if (restricted.some((f) => f.sensitive)) fail("applyFieldVisibility left a sensitive field");

// Projection includes row identity even for a minimal selection.
const minimal = resolveFields(["student_name"]);
if (!studentColumnsFor(minimal).includes("id")) fail("studentColumnsFor omitted id");
if (!enrollmentColumnsFor(minimal).includes("student_id")) fail("enrollmentColumnsFor omitted student_id");

// The projection is genuinely narrow — this is the security claim.
const narrow = studentColumnsFor(minimal);
if (narrow.includes("aadhar_number")) fail("minimal selection still projects aadhar_number");

// ─── 5. Seeded preset field keys resolve ────────────────────────────────────
// Migration 093 seeds two shared presets by field key. Unknown keys are
// dropped silently on load, so a typo there costs a missing column with no
// error anywhere — exactly the kind of thing only a check like this catches.
const presetSql = readFileSync(
  new URL("./migrations/erp/migration-093-report-presets.sql", import.meta.url),
  "utf8"
);
const knownKeys = new Set(REPORT_FIELDS.map((f) => f.key));
const seededKeys = [...presetSql.matchAll(/ARRAY\[([^\]]+)\]/g)].flatMap((m) =>
  [...m[1].matchAll(/'([a-z0-9_]+)'/g)].map((k) => k[1])
);
if (seededKeys.length === 0) fail("could not parse any field keys out of migration 093");
for (const key of seededKeys) {
  if (!knownKeys.has(key)) fail(`migration 093 seeds unknown field key "${key}"`);
}

// ─── 6. Focus presets resolve ───────────────────────────────────────────────
// Same failure mode as the seeded presets: REPORT_FOCUSES drives the Fee /
// Attendance / Result entry points, and an unknown key there silently yields a
// report missing the very column the entry point exists to show.
let focusKeyCount = 0;
for (const [name, focus] of Object.entries(REPORT_FOCUSES)) {
  for (const key of focus.fields) {
    focusKeyCount += 1;
    if (!knownKeys.has(key)) fail(`focus "${name}" names unknown field key "${key}"`);
  }
  if (focus.sort_by && !knownKeys.has(focus.sort_by)) {
    fail(`focus "${name}" sorts by unknown field key "${focus.sort_by}"`);
  }
  const sortField = REPORT_FIELDS.find((f) => f.key === focus.sort_by);
  if (sortField && !sortField.sortable) {
    fail(`focus "${name}" sorts by "${focus.sort_by}", which is not sortable`);
  }
}

// ─── Report ─────────────────────────────────────────────────────────────────
console.log(`fields          : ${REPORT_FIELDS.length}`);
console.log(`  always-on     : ${ALWAYS_FIELD_KEYS.join(", ")}`);
console.log(`  sortable      : ${SORTABLE_FIELDS.length}`);
console.log(`  sensitive     : ${sensitiveCount}`);
console.log(`  groups        : ${REPORT_GROUPS.length}`);
console.log(`projection for "Name only": ${narrow.join(", ")}`);
console.log(`seeded preset keys : ${seededKeys.length} (all resolve)`);
console.log(`focus preset keys  : ${focusKeyCount} across ${Object.keys(REPORT_FOCUSES).length} focuses (all resolve)`);

if (failures.length) {
  console.error(`\n${failures.length} FAILURE(S):`);
  for (const f of failures) console.error(`  ✗ ${f}`);
  process.exit(1);
}
console.log("\nall checks passed");
