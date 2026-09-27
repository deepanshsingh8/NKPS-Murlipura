/**
 * End-to-end check of the report engine against the live database.
 *
 *   npx tsx scripts/_verify-report-live.mts
 *
 * READ-ONLY. Runs the same runStudentReport() the API calls, and asserts the
 * one property that fails silently rather than loudly:
 *
 *   a report for a PAST session must print that session's class, not today's.
 *
 * Everything else in this feature errors when it breaks. That one just prints
 * plausible, wrong numbers.
 */

import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { runStudentReport } from "../apps/erp/src/lib/report-query";
import { resolveFields } from "../packages/shared/src/lib/report-fields";
import { reportFiltersSchema } from "../packages/shared/src/lib/report-filters";

const env = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
const read = (k: string) =>
  env.match(new RegExp(`^${k}=(.*)$`, "m"))?.[1]?.trim().replace(/^["']|["']$/g, "");
const db = createClient(read("NEXT_PUBLIC_SUPABASE_URL")!, read("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false },
});

const failures: string[] = [];
const fail = (m: string) => failures.push(m);

const { data: years } = await db
  .from("academic_years")
  .select("id, name, start_date, end_date, is_current")
  .order("name", { ascending: false });

if (!years?.length) {
  console.error("No academic years — nothing to report on.");
  process.exit(1);
}
console.log(`sessions: ${years.map((y) => y.name).join(", ")}\n`);

const run = async (sessionId: string, fieldKeys: string[], extra: Record<string, unknown> = {}) => {
  const filters = reportFiltersSchema.parse({
    session_id: sessionId,
    fields: fieldKeys,
    statuses: ["active", "passed", "failed", "terminated", "exited"],
    ...extra,
  });
  return runStudentReport(db, filters, resolveFields(filters.fields));
};

// ─── 1. Every session returns its own cohort ────────────────────────────────
const perSession = new Map<string, { total: number; sample?: string }>();
for (const y of years) {
  const res = await run(y.id, ["admission_no", "class_section"]);
  perSession.set(y.id, {
    total: res.total,
    sample: res.rows[0]
      ? `${res.rows[0].student.full_name} → ${res.rows[0].klass?.name ?? "?"}`
      : undefined,
  });
  console.log(
    `${y.name.padEnd(12)} ${String(res.total).padStart(5)} students` +
      (res.rows[0] ? `   e.g. ${perSession.get(y.id)!.sample}` : "")
  );
}

// ─── 2. THE session-scoping check ───────────────────────────────────────────
// Find a student enrolled in two different sessions under different classes,
// then assert each session's report shows that session's class.
console.log("\n─── session-scoping ───");
const { data: multi } = await db
  .from("student_enrollments")
  .select("student_id, academic_year_id, class_id, classes(name, section)")
  .range(0, 9999);

const byStudent = new Map<string, { year: string; klass: string }[]>();
for (const raw of multi ?? []) {
  const r = raw as unknown as {
    student_id: string;
    academic_year_id: string;
    classes: { name: string; section: string | null } | { name: string; section: string | null }[] | null;
  };
  const rel = Array.isArray(r.classes) ? r.classes[0] : r.classes;
  if (!rel) continue;
  const list = byStudent.get(r.student_id) ?? [];
  list.push({ year: r.academic_year_id, klass: rel.section ? `${rel.name}-${rel.section}` : rel.name });
  byStudent.set(r.student_id, list);
}

const candidate = [...byStudent.entries()].find(
  ([, rows]) =>
    rows.length >= 2 && new Set(rows.map((r) => r.klass)).size >= 2
);

if (!candidate) {
  console.log("No student has enrollments in two different classes — check skipped.");
} else {
  const [studentId, enrolments] = candidate;
  const yearName = (id: string) => years.find((y) => y.id === id)?.name ?? id;
  for (const enr of enrolments) {
    const res = await run(enr.year, ["admission_no", "class_section"]);
    const row = res.rows.find((r) => r.student.id === studentId);
    const printed = row?.klass
      ? row.klass.section
        ? `${row.klass.name}-${row.klass.section}`
        : row.klass.name
      : "(absent)";
    const ok = printed === enr.klass;
    console.log(
      `  ${yearName(enr.year).padEnd(12)} expected ${enr.klass.padEnd(14)} printed ${printed.padEnd(14)} ${ok ? "✓" : "✗"}`
    );
    if (!ok) {
      fail(`session ${yearName(enr.year)}: printed "${printed}", that session's class is "${enr.klass}"`);
    }
  }
  const name = (await db.from("students").select("full_name").eq("id", studentId).maybeSingle())
    .data?.full_name;
  console.log(`  (student: ${name})`);
}

// ─── 3. The optional joins actually populate ────────────────────────────────
console.log("\n─── fee / attendance / result joins ───");
const current = years.find((y) => y.is_current) ?? years[0];
const rich = await run(current.id, [
  "admission_no", "class_section",
  "fee_billed", "fee_paid", "fee_balance", "fee_status",
  "attendance_present", "attendance_total", "attendance_percent",
  "result_obtained", "result_max", "result_percent",
]);
console.log(`${current.name}: ${rich.total} students`);

const withFees = rich.rows.filter((r) => (r.fees?.billed ?? 0) > 0).length;
const withAtt = rich.rows.filter((r) => (r.attendance?.total ?? 0) > 0).length;
const withRes = rich.rows.filter((r) => (r.results?.max ?? 0) > 0).length;
console.log(`  fee lines billed   : ${withFees}/${rich.total}`);
console.log(`  attendance marked  : ${withAtt}/${rich.total}`);
console.log(`  results recorded   : ${withRes}/${rich.total}`);

for (const row of rich.rows.slice(0, 3)) {
  console.log(
    `  ${String(row.student.full_name).slice(0, 22).padEnd(24)}` +
      `${(row.klass?.name ?? "—").padEnd(10)}` +
      `billed ${String(row.fees?.billed ?? 0).padStart(7)}  ` +
      `paid ${String(row.fees?.paid ?? 0).padStart(7)}  ` +
      `bal ${String(row.fees?.balance ?? 0).padStart(7)}  ` +
      `att ${row.attendance?.percent ?? "—"}%`
  );
}

// Invariants that must hold whatever the data says.
for (const row of rich.rows) {
  if ((row.fees?.balance ?? 0) < 0) fail(`${row.student.full_name}: negative fee balance`);
  const p = row.attendance?.percent;
  if (p !== null && p !== undefined && (p < 0 || p > 100)) {
    fail(`${row.student.full_name}: attendance ${p}% out of range`);
  }
  const rp = row.results?.percent;
  if (rp !== null && rp !== undefined && (rp < 0 || rp > 100)) {
    fail(`${row.student.full_name}: result ${rp}% out of range`);
  }
  if ((row.attendance?.total ?? 0) > 0 && row.attendance?.percent === null) {
    fail(`${row.student.full_name}: days marked but no percentage`);
  }
}

// ─── 4. Filters narrow rather than error ────────────────────────────────────
console.log("\n─── derived filters ───");
const due = await run(current.id, ["admission_no", "fee_balance"], { fee_status: "due" });
const clear = await run(current.id, ["admission_no", "fee_balance"], { fee_status: "clear" });
console.log(`  fee_status=due   : ${due.total}`);
console.log(`  fee_status=clear : ${clear.total}`);
if (due.total + clear.total !== rich.total) {
  fail(`due (${due.total}) + clear (${clear.total}) != all (${rich.total})`);
}
if (due.rows.some((r) => (r.fees?.balance ?? 0) < 1)) fail("fee_status=due returned a settled student");
if (clear.rows.some((r) => (r.fees?.balance ?? 0) >= 1)) fail("fee_status=clear returned a student with dues");

const low = await run(current.id, ["admission_no", "attendance_percent"], { attendance_below: 75 });
console.log(`  attendance_below=75 : ${low.total}`);
if (low.rows.some((r) => (r.attendance?.percent ?? 100) >= 75)) {
  fail("attendance_below returned a student at or above the threshold");
}

// ─── 5. Column projection really is narrow ──────────────────────────────────
const minimal = await run(current.id, ["student_name"]);
const leaked = minimal.rows.filter((r) => "aadhar_number" in r.student).length;
console.log(`\n─── projection ───\n  name-only report leaking aadhar_number: ${leaked} rows`);
if (leaked > 0) fail(`${leaked} rows carried aadhar_number in a name-only report`);

console.log("\n" + "─".repeat(60));
if (failures.length) {
  console.error(`${failures.length} FAILURE(S):`);
  for (const f of failures) console.error(`  ✗ ${f}`);
  process.exit(1);
}
console.log("all live checks passed");
