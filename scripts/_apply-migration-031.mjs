// Apply migration-031-teacher-substitutions.sql via the Supabase Postgres
// connection. Uses the service role key.
//
// Run with: node --env-file=.env.local scripts/_apply-migration-031.mjs
//
// Idempotent — the migration uses CREATE TABLE IF NOT EXISTS, DROP/CREATE
// triggers, and DROP/CREATE policies, so re-running is safe.
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const sql = readFileSync(
  new URL("./migrations/erp/migration-031-teacher-substitutions.sql", import.meta.url),
  "utf8"
);

// Supabase JS client doesn't expose raw SQL execution — we need to use the
// REST endpoint or the SQL endpoint. The simplest portable approach: post to
// the database via PostgREST RPC if a `query` RPC exists, or fall back to
// pg-meta. For this project the convention has been to apply migrations via
// the Supabase Studio SQL editor, so this script is a convenience: it tries
// the `pg-meta` admin API and falls back to printing the SQL for paste.

// Try the management API first (Supabase project endpoint).
// The service role key cannot execute arbitrary SQL via the JS client,
// so this script just prints clear instructions.

console.log("=".repeat(70));
console.log("Migration 031: Teacher Absences + Substitutions");
console.log("=".repeat(70));
console.log("\nThe Supabase JS client cannot run arbitrary DDL. Apply this");
console.log("migration via one of:");
console.log("  1. Supabase Studio → SQL editor → paste contents of");
console.log("     scripts/migrations/erp/migration-031-teacher-substitutions.sql");
console.log("  2. psql against the project's Postgres connection string.");
console.log("\nVerifying current state of the two tables…\n");

const supa = createClient(url, key, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const targets = ["teacher_absences", "substitutions"];
let allExist = true;
for (const t of targets) {
  const { error, count } = await supa.from(t).select("*", {
    count: "exact",
    head: true,
  });
  if (error) {
    console.log(`  [MISSING] ${t.padEnd(22)} → ${error.code} ${error.message}`);
    allExist = false;
  } else {
    console.log(`  [OK]      ${t.padEnd(22)} → rows=${count ?? 0}`);
  }
}

if (allExist) {
  console.log("\nBoth tables exist. Migration appears to be applied already.");
} else {
  console.log("\nApply the migration in Supabase Studio, then re-run this script.");
  console.log("\nMigration SQL length:", sql.length, "chars");
}
