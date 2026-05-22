// Inspect the actual columns of teacher_absences and substitutions in the
// live DB. CREATE TABLE IF NOT EXISTS is a no-op if the tables already
// exist, so we need to confirm the existing shape matches what migration 030
// declares before any API code can rely on it.
//
// Run with: node --env-file=.env.local scripts/_inspect-substitution-tables.mjs
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const supa = createClient(url, key, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// Trick to get column metadata: select * with limit 0; PostgREST returns the
// column list in the response shape error message if we ask for a fake col.
async function inspect(table) {
  console.log(`\n--- ${table} ---`);
  // Try selecting each expected column individually; missing ones come back
  // as PostgREST errors.
  const expected = {
    teacher_absences: [
      "id",
      "teacher_id",
      "absence_date",
      "half_day",
      "reason",
      "marked_by",
      "created_at",
      "updated_at",
    ],
    substitutions: [
      "id",
      "absence_id",
      "timetable_period_id",
      "substitute_teacher_id",
      "note",
      "assigned_by",
      "created_at",
      "updated_at",
    ],
  }[table];

  for (const col of expected) {
    const { error } = await supa.from(table).select(col).limit(0);
    if (error) {
      console.log(`  [MISSING] ${col.padEnd(24)} → ${error.code} ${error.message}`);
    } else {
      console.log(`  [OK]      ${col}`);
    }
  }
}

await inspect("teacher_absences");
await inspect("substitutions");
