/**
 * Reports which recent ERP migrations are actually applied to the live
 * database, by probing for the objects each one creates.
 *
 *   npx tsx scripts/_check-migrations-applied.mts
 *
 * READ-ONLY. Every probe is a `select … limit 0`: it asks PostgREST whether a
 * table or column exists and never reads a row of data, so this is safe to run
 * against production.
 *
 * There is no migrations ledger in this project — migrations are applied by
 * hand in the Supabase SQL editor — so "which have I run?" is otherwise
 * unanswerable. This is the substitute.
 */

import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const env = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
const read = (key: string) =>
  env.match(new RegExp(`^${key}=(.*)$`, "m"))?.[1]?.trim().replace(/^["']|["']$/g, "");

const url = read("NEXT_PUBLIC_SUPABASE_URL");
const serviceKey = read("SUPABASE_SERVICE_ROLE_KEY");
if (!url || !serviceKey) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local");
  process.exit(1);
}

const db = createClient(url, serviceKey, { auth: { persistSession: false } });

interface Probe {
  migration: string;
  what: string;
  table: string;
  /** Omit to probe only that the table exists. */
  column?: string;
}

const PROBES: Probe[] = [
  { migration: "085", what: "fee instalment schedule", table: "fee_structures", column: "instalment_no" },
  { migration: "086", what: "enrollment created_at", table: "student_enrollments", column: "created_at" },
  { migration: "087", what: "student_status_history", table: "student_status_history" },
  // 088 alters an FK's ON DELETE action — nothing to probe for. Reported separately.
  { migration: "089", what: "student report columns", table: "students", column: "pen_number" },
  { migration: "090a", what: "houses master", table: "houses" },
  { migration: "090b", what: "enrollment house_id", table: "student_enrollments", column: "house_id" },
  { migration: "091", what: "export_events", table: "export_events" },
  { migration: "092", what: "historical_corrections", table: "historical_corrections" },
  { migration: "093", what: "report_presets", table: "report_presets" },
  { migration: "094a", what: "teacher_absences", table: "teacher_absences" },
  { migration: "094b", what: "substitutions", table: "substitutions" },
];

const results: { migration: string; what: string; applied: boolean; detail: string }[] = [];

for (const probe of PROBES) {
  const { error } = await db
    .from(probe.table)
    .select(probe.column ?? "*")
    .limit(0);

  if (!error) {
    results.push({ migration: probe.migration, what: probe.what, applied: true, detail: "" });
    continue;
  }
  // 42P01 = undefined_table, 42703 = undefined_column, PGRST20x = schema cache miss.
  const missing = /42P01|42703|PGRST20|does not exist|Could not find/i.test(
    `${error.code} ${error.message}`
  );
  results.push({
    migration: probe.migration,
    what: probe.what,
    applied: false,
    detail: missing ? "not applied" : `probe failed: ${error.message}`,
  });
}

const pad = (s: string, n: number) => s.padEnd(n);
console.log(`\n${pad("MIGRATION", 12)}${pad("WHAT", 30)}STATUS`);
console.log("─".repeat(60));
for (const r of results) {
  console.log(
    `${pad(r.migration, 12)}${pad(r.what, 30)}${r.applied ? "✓ applied" : `✗ ${r.detail}`}`
  );
}

const pending = results.filter((r) => !r.applied);
console.log("\n" + "─".repeat(60));
if (pending.length === 0) {
  console.log("Every probed migration is applied.");
} else {
  console.log(`STILL TO RUN: ${pending.map((p) => p.migration).join(", ")}`);
}
console.log(
  "\nNote: 088 (subject-delete-integrity) only changes an FK's ON DELETE action,\n" +
    "so there is no object to probe. Check it by deleting a subject that appears\n" +
    "in a timetable — it should succeed rather than error."
);
