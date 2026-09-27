/**
 * Verifies that migration 098 actually closed the anonymous read of staff and
 * student data on the LIVE database.
 *
 *   npx tsx scripts/_verify-staff-pii-lockdown.mts
 *
 * READ-ONLY. It only issues selects, and the point of the exercise is that the
 * important ones should come back empty.
 *
 * The check that matters uses the ANON key — the same key that ships inside
 * the public website's JavaScript bundle, and the one an attacker would use.
 * Reading the policy catalogue with the service-role key would only tell us
 * what the policies say; this tells us what an unauthenticated caller on the
 * internet can actually retrieve, which is the question.
 *
 * Exit code is 1 if anything is still exposed, so this can gate a deploy.
 */

import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const env = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
const read = (key: string) =>
  env.match(new RegExp(`^${key}=(.*)$`, "m"))?.[1]?.trim().replace(/^["']|["']$/g, "");

const url = read("NEXT_PUBLIC_SUPABASE_URL");
const anonKey = read("NEXT_PUBLIC_SUPABASE_ANON_KEY");
const serviceKey = read("SUPABASE_SERVICE_ROLE_KEY");

if (!url || !anonKey) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY in .env.local");
  process.exit(2);
}

const anon = createClient(url, anonKey);
const admin = serviceKey ? createClient(url, serviceKey) : null;

let failures = 0;
const pass = (m: string) => console.log(`  PASS  ${m}`);
const fail = (m: string) => {
  failures++;
  console.log(`  FAIL  ${m}`);
};

/** These must return zero rows to an anonymous caller. */
const MUST_BE_CLOSED = [
  "teachers",
  "staff_members",
  "student_subjects",
  "student_elective_picks",
];

/** Columns that must never be reachable anonymously, anywhere. */
const PII = ["aadhar_number", "date_of_birth", "address", "phone", "email", "license_number"];

async function main() {
  console.log(`\nTarget: ${url}\n`);

  console.log("1. Anonymous reads of tables holding personal data");
  for (const table of MUST_BE_CLOSED) {
    const { data, error } = await anon.from(table).select("*").limit(1);
    if (error) {
      // A permission error is a perfectly good outcome — the row never left the DB.
      pass(`${table}: blocked (${error.code ?? error.message})`);
    } else if (!data || data.length === 0) {
      pass(`${table}: 0 rows visible to anon`);
    } else {
      const leaked = PII.filter((c) => c in (data[0] as Record<string, unknown>));
      fail(
        `${table}: ${data.length} row(s) READABLE BY ANON` +
          (leaked.length ? ` — exposing ${leaked.join(", ")}` : "")
      );
    }
  }

  console.log("\n2. Public staff directory still works, and only exposes safe columns");
  const { data: dir, error: dirErr } = await anon
    .from("public_staff_directory")
    .select("id, name, subject, category, photo_url, qualifications, sort_order")
    .limit(3);
  if (dirErr) {
    fail(`public_staff_directory unreadable by anon: ${dirErr.message} — the website will fall back to its static staff list`);
  } else {
    pass(`public_staff_directory readable by anon (${dir?.length ?? 0} row(s) sampled)`);
    const row = (dir?.[0] ?? {}) as Record<string, unknown>;
    const leaked = PII.filter((c) => c in row);
    if (leaked.length) fail(`directory exposes ${leaked.join(", ")}`);
    else pass("directory carries no personal columns");
  }

  console.log("\n3. Migration 049 objects present (electives feature)");
  if (!admin) {
    console.log("  SKIP  no service-role key available");
  } else {
    for (const table of [
      "student_elective_picks",
      "elective_slot_options",
      "timetable_templates",
      "timetable_template_periods",
    ]) {
      const { error } = await admin.from(table).select("*").limit(0);
      if (error) fail(`${table}: missing (${error.message})`);
      else pass(`${table}: exists`);
    }
  }

  console.log(
    failures === 0
      ? "\nAll checks passed. Nothing readable anonymously; the public directory still works.\n"
      : `\n${failures} check(s) FAILED — see above.\n`
  );
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
