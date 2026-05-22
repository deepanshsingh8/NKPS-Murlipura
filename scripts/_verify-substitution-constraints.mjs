// Verify migration-030 constraints by attempting invalid inserts.
// All inserts use a fake teacher UUID to fail FK first, OR the test relies on
// the CHECK firing before the FK — Postgres typically validates checks on
// the row level alongside FKs.
//
// Run with: node --env-file=.env.local scripts/_verify-substitution-constraints.mjs
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supa = createClient(url, key, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// Pick any real teacher to satisfy the FK so we can isolate CHECK failures.
const { data: t } = await supa.from("teachers").select("id").limit(1);
const teacherId = t?.[0]?.id;
if (!teacherId) {
  console.log("No teachers in DB — cannot verify CHECK constraints. Skipping.");
  process.exit(0);
}
console.log(`Using teacher_id=${teacherId} for constraint tests.\n`);

// 1. CHECK on half_day — should reject 'maybe'.
const bogusDate = "2099-01-01";
const { error: checkErr } = await supa
  .from("teacher_absences")
  .insert({ teacher_id: teacherId, absence_date: bogusDate, half_day: "maybe" });
console.log(
  checkErr
    ? `[OK]   half_day CHECK rejected invalid value → ${checkErr.code} ${checkErr.message.slice(0, 80)}`
    : "[FAIL] half_day CHECK did not fire"
);

// 2. UNIQUE(teacher_id, absence_date) — insert valid, then duplicate.
const { data: ins1, error: ins1Err } = await supa
  .from("teacher_absences")
  .insert({ teacher_id: teacherId, absence_date: bogusDate, half_day: "full" })
  .select("id")
  .single();
if (ins1Err) {
  console.log(`[SKIP] could not insert baseline row → ${ins1Err.code} ${ins1Err.message}`);
} else {
  const { error: dupErr } = await supa
    .from("teacher_absences")
    .insert({ teacher_id: teacherId, absence_date: bogusDate, half_day: "first_half" });
  console.log(
    dupErr && dupErr.code === "23505"
      ? "[OK]   UNIQUE(teacher_id, absence_date) rejected duplicate"
      : `[FAIL] UNIQUE did not fire → ${dupErr?.code ?? "no error"}`
  );

  // Cleanup.
  await supa.from("teacher_absences").delete().eq("id", ins1.id);
  console.log(`[clean] removed test row id=${ins1.id}`);
}
