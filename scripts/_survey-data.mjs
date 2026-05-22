import { createClient } from "@supabase/supabase-js";

const supa = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

async function survey() {
  const { data: year } = await supa
    .from("academic_years")
    .select("id, name, is_current")
    .eq("is_current", true)
    .maybeSingle();
  console.log("Current year:", year);

  const { data: classes } = await supa
    .from("classes")
    .select("id, name, section, academic_year_id")
    .eq("academic_year_id", year.id)
    .order("sort_order", { ascending: true })
    .limit(5);
  console.log("\nClasses (first 5):");
  for (const c of classes ?? []) {
    const { count: enrolled } = await supa
      .from("student_enrollments")
      .select("*", { count: "exact", head: true })
      .eq("class_id", c.id)
      .eq("status", "active");
    const { count: subjects } = await supa
      .from("class_subjects")
      .select("*", { count: "exact", head: true })
      .eq("class_id", c.id);
    console.log(
      `  ${c.id.slice(0, 8)}  ${c.name}-${c.section}  students=${enrolled}  subjects=${subjects}`
    );
  }

  const { data: exams } = await supa
    .from("exam_types")
    .select("id, name, max_marks, academic_year_id")
    .eq("academic_year_id", year.id)
    .order("sort_order", { ascending: true });
  console.log(`\nExams (${exams?.length ?? 0}):`);
  for (const e of exams ?? []) {
    console.log(`  ${e.id.slice(0, 8)}  ${e.name}  max=${e.max_marks}`);
  }

  const { count: resultsCount } = await supa
    .from("results")
    .select("*", { count: "exact", head: true });
  console.log(`\nTotal result rows: ${resultsCount}`);

  const { count: rmCount } = await supa
    .from("result_masters")
    .select("*", { count: "exact", head: true });
  console.log(`Result masters configured: ${rmCount}`);

  // Look for an adults we can use as test actors.
  const { data: profiles } = await supa
    .from("profiles")
    .select("id, role, email")
    .in("role", ["admin", "teacher", "parent"])
    .limit(20);
  const byRole = {};
  for (const p of profiles ?? []) {
    (byRole[p.role] ??= []).push(p.email ?? p.id.slice(0, 8));
  }
  console.log("\nProfiles by role:");
  for (const [role, list] of Object.entries(byRole)) {
    console.log(`  ${role}: ${list.length}`);
  }
}
survey().catch((e) => {
  console.error(e);
  process.exit(1);
});
