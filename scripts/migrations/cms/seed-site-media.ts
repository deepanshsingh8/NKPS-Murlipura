/**
 * Seed script for site_media (page-chrome image slots only).
 *
 * Per-card images (hero slides, facility cards, leadership photos, etc.) used
 * to live here as site_media slots; migrations 051–058 fold them into
 * section_cards.image_url. The slots remaining in this file are the
 * site-wide chrome that isn't tied to any card — stats backdrop, founder
 * photo, about hero, facilities hero banner, school logo.
 *
 * Behaviour: insert-if-missing on the unique `slot` column. Existing rows
 * (including any current_url an admin has uploaded) are NEVER touched.
 * Editing default_url/label here will not retroactively update the DB —
 * make schema-touching changes via a numbered migration in this folder.
 *
 * Usage: npx tsx scripts/migrations/cms/seed-site-media.ts
 *
 * Requires NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local
 */

import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import { resolve } from "path";

config({ path: resolve(__dirname, "../../../.env.local") });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!supabaseUrl || !serviceRoleKey) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceRoleKey);

// Per-card images (hero slides, facility previews, latest updates, student-
// life activities, leadership photos, campus facility cards, etc.) used to
// live here as site_media slots. Migrations 051–058 fold them into
// section_cards.image_url — one source of truth per card. The slots below are
// only the page-chrome backgrounds that aren't tied to any card.
const slots = [
  // Home — Stats Counter background
  { slot: "stats_background", page: "home", section: "stats_counter", label: "Stats Section Background", default_url: "/images/gallery/g10.jpg", alt_text: "Campus Background", sort_order: 0 },

  // Facilities Page — hero banner (page chrome, not a card)
  { slot: "facilities_hero", page: "facilities", section: "campus_facilities", label: "Facilities — Hero Banner", default_url: "/images/hero/campus-1.jpg", alt_text: "NK Public School Campus", sort_order: 0 },

  // About — Founder
  { slot: "founder_photo", page: "about", section: "founder_tribute", label: "Founder Photo", default_url: "/images/about/rk-choudhary.png", alt_text: "Late Shri R.K. Choudhary", sort_order: 0 },

  // About — Hero Image
  { slot: "about_hero", page: "about", section: "hero", label: "About Page Hero Image", default_url: "/images/gallery/g10.jpg", alt_text: "NK Public School Campus", sort_order: 0 },

  // Global — Logo
  { slot: "site_logo", page: "global", section: "branding", label: "School Logo", default_url: "/images/logo.png", alt_text: "NK Public School Logo", sort_order: 0 },
];

async function seed() {
  console.log(`Seeding ${slots.length} site_media slots...`);

  const records = slots.map((s) => ({
    ...s,
    current_url: s.default_url,
  }));

  // INSERT … ON CONFLICT (slot) DO NOTHING — preserves admin-customised
  // current_url. Do NOT change ignoreDuplicates to false: that turns this
  // into a real upsert and would silently reset every customised image to
  // its default on the next run.
  const { error } = await supabase
    .from("site_media")
    .upsert(records, { onConflict: "slot", ignoreDuplicates: true });

  if (error) {
    console.error("Seed failed:", error.message);
    process.exit(1);
  }

  console.log(`Done! ${slots.length} slots seeded (existing rows untouched).`);
}

seed().catch((err) => {
  console.error("Seed crashed:", err);
  process.exit(1);
});
