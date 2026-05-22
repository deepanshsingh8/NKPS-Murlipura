// Inspect the offending teacher_id/day/period pair that blocked
// migration-030-timetable-teacher-unique. Pull both rows in full so we can
// see whether this is a real double-booking (overlapping times, same teacher
// in two places at once) or just a same-period-name-different-time situation
// (staggered schedules).
//
// Also list every (teacher_id, day_of_week, period_number) duplicate so we
// know the full extent before deciding on the right constraint shape.
//
// Run with: node --env-file=.env.local scripts/_inspect-teacher-duplicate.mjs
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supa = createClient(url, key, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// Get all timetable_periods rows with a teacher.
const { data: rows, error } = await supa
  .from("timetable_periods")
  .select(
    "id, class_id, subject_id, teacher_id, day_of_week, period_number, start_time, end_time, room, classes(name, section), subjects(name), teachers(full_name)"
  );
if (error) {
  console.error(error);
  process.exit(2);
}

console.log(`Total rows: ${rows.length}\n`);

// Group by (teacher, day, period_number) and find duplicates.
const groups = new Map();
for (const r of rows) {
  if (!r.teacher_id) continue;
  const key = `${r.teacher_id}|${r.day_of_week}|${r.period_number}`;
  if (!groups.has(key)) groups.set(key, []);
  groups.get(key).push(r);
}

const dups = [...groups.values()].filter((g) => g.length > 1);
console.log(`Duplicate (teacher, day, period_number) groups: ${dups.length}\n`);

for (const g of dups) {
  const teacher = g[0].teachers?.full_name ?? "(unknown)";
  console.log(
    `Teacher: ${teacher}  day=${g[0].day_of_week}  period_number=${g[0].period_number}`
  );
  for (const r of g) {
    const cls = `${r.classes?.name ?? "?"}-${r.classes?.section ?? "?"}`;
    const sub = r.subjects?.name ?? "(no subject)";
    console.log(
      `   class=${cls.padEnd(8)} subject=${sub.padEnd(20)} time=${r.start_time}–${r.end_time}  room=${r.room ?? "—"}  id=${r.id}`
    );
  }

  // Time-overlap check: do any two rows in this group actually overlap?
  let overlap = false;
  for (let i = 0; i < g.length; i++) {
    for (let j = i + 1; j < g.length; j++) {
      if (g[i].start_time < g[j].end_time && g[i].end_time > g[j].start_time) {
        overlap = true;
      }
    }
  }
  console.log(
    `   ${overlap ? "REAL CONFLICT — times overlap" : "Same period_number, but times DO NOT overlap (staggered)"}\n`
  );
}

// Also do a separate, broader check: any (teacher, day) where any two rows
// have overlapping times — even if period_number differs. This is what the
// substitution algorithm cares about.
console.log("=".repeat(60));
console.log("Broader check: any teacher with TIME-OVERLAPPING rows on same day?");
console.log("=".repeat(60));

const byTeacherDay = new Map();
for (const r of rows) {
  if (!r.teacher_id) continue;
  const key = `${r.teacher_id}|${r.day_of_week}`;
  if (!byTeacherDay.has(key)) byTeacherDay.set(key, []);
  byTeacherDay.get(key).push(r);
}

let foundAny = false;
for (const [, list] of byTeacherDay) {
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      const a = list[i];
      const b = list[j];
      if (a.start_time < b.end_time && a.end_time > b.start_time) {
        foundAny = true;
        const teacher = a.teachers?.full_name ?? "(unknown)";
        const ca = `${a.classes?.name ?? "?"}-${a.classes?.section ?? "?"}`;
        const cb = `${b.classes?.name ?? "?"}-${b.classes?.section ?? "?"}`;
        console.log(
          `${teacher}  day=${a.day_of_week}  ${ca}@${a.start_time}-${a.end_time} vs ${cb}@${b.start_time}-${b.end_time}`
        );
      }
    }
  }
}
if (!foundAny) {
  console.log("No real time-overlap double-bookings detected.");
}
