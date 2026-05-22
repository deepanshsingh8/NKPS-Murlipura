// One-off check: do all classes share the same start_time for a given
// period_number, or do classes run staggered schedules?
// Run with: node --env-file=.env.local scripts/_check-period-times.mjs
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

const { data, error, count } = await supa
  .from("timetable_periods")
  .select("class_id, day_of_week, period_number, start_time, end_time, is_break", {
    count: "exact",
  });

if (error) {
  console.error("Query error:", error);
  process.exit(2);
}

console.log(`Total timetable_periods rows: ${count}\n`);

if (!data || data.length === 0) {
  console.log("No rows yet — assumption cannot be verified empirically.");
  process.exit(0);
}

// Group by period_number → set of distinct start_times.
const byPeriod = new Map();
for (const row of data) {
  if (row.is_break) continue;
  const key = row.period_number;
  if (!byPeriod.has(key)) byPeriod.set(key, new Map());
  const slotMap = byPeriod.get(key);
  const slotKey = `${row.start_time}-${row.end_time}`;
  slotMap.set(slotKey, (slotMap.get(slotKey) ?? 0) + 1);
}

console.log("Period N → distinct (start-end) time slots and row counts:");
const sorted = [...byPeriod.keys()].sort((a, b) => a - b);
let staggered = false;
for (const p of sorted) {
  const slots = byPeriod.get(p);
  const slotList = [...slots.entries()]
    .map(([s, c]) => `${s} (×${c})`)
    .join(", ");
  const tag = slots.size > 1 ? "  STAGGERED" : "  uniform";
  if (slots.size > 1) staggered = true;
  console.log(`  P${p}: ${slots.size} distinct slot(s)  →  ${slotList}${tag}`);
}

console.log("\n=== VERDICT ===");
if (staggered) {
  console.log(
    "Classes RUN STAGGERED for at least one period. Substitute-availability check MUST use start_time/end_time overlap, not period_number."
  );
} else {
  console.log(
    "Period N is uniform across classes. period_number alone is sufficient for the availability check (but the more robust time-overlap check still works correctly)."
  );
}
