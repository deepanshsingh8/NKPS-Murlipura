// Check which Phase 5+6 tables exist in the running Supabase project.
// Run with: node --env-file=.env.local scripts/_check-migrations.mjs
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

// A non-existent table surfaces as PostgrestError code 42P01 (table not
// found). `head:true, count:exact` gives us a cheap existence probe without
// pulling rows.
const tables = [
  "marksheet_publications", // Phase 5
  "publish_events", // Phase 5
  "ptm_notes", // Phase 6B
  "school_meeting_counts", // Phase 6B
  "ptm_formats", // Phase 6C
];

console.log("Checking migration-applied tables:\n");
let allOk = true;
for (const t of tables) {
  const { error, count } = await supa.from(t).select("*", {
    count: "exact",
    head: true,
  });
  if (error) {
    console.log(`  [MISSING] ${t.padEnd(28)} → ${error.code} ${error.message}`);
    allOk = false;
  } else {
    console.log(`  [OK]      ${t.padEnd(28)} → rows=${count ?? 0}`);
  }
}

process.exit(allOk ? 0 : 2);
