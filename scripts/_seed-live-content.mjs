// Seed AUTHENTIC content scraped from the school's own live site
// (nkpublicschool.org) into Supabase. Continues the launch-parity work: the
// gallery tables were empty and the achievements section only had a handful of
// cards. Everything here is Murlipura-verifiable — sourced from
// `_reference/scraped/live-inventory.md` and the photos in
// `_reference/scraped/assets/live/`.
//
// Idempotent:
//   * images upsert to storage (re-runs overwrite, never error)
//   * gallery seed is skipped entirely once gallery_images has any rows
//   * student_achievements only inserts names not already present
//
// Run:  node --env-file=.env.local scripts/_seed-live-content.mjs
import { readFileSync, readdirSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) { console.error("Missing Supabase env"); process.exit(1); }
const supa = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });

const LIVE = new URL("../_reference/scraped/assets/live/", import.meta.url);
const GALLERY_BUCKET = "gallery";

const ctype = (f) => (f.toLowerCase().endsWith(".png") ? "image/png" : "image/jpeg");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Upload one local file to the gallery bucket under live/<name>; return public
// URL. Retries transient network failures (the live scrape is ~130 files and
// the connection occasionally drops mid-batch).
async function upload(name) {
  const buf = readFileSync(new URL(name, LIVE));
  const dest = `live/${name}`;
  let lastErr;
  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      const { error } = await supa.storage
        .from(GALLERY_BUCKET)
        .upload(dest, buf, { contentType: ctype(name), upsert: true });
      if (error && !`${error.message}`.includes("exists")) throw new Error(error.message);
      return supa.storage.from(GALLERY_BUCKET).getPublicUrl(dest).data.publicUrl;
    } catch (e) {
      lastErr = e;
      if (attempt < 5) await sleep(500 * attempt);
    }
  }
  throw new Error(`upload ${dest} (after retries): ${lastErr?.message}`);
}

const files = new Set(readdirSync(LIVE));
const has = (n) => files.has(n);
const glob = (re) => [...files].filter((f) => re.test(f)).sort();

// ───────────────────────────────────────────────────────────────────────────
// 1. Gallery — events + images (skipped if already seeded)
// ───────────────────────────────────────────────────────────────────────────
async function seedGallery() {
  const { count } = await supa.from("gallery_images").select("*", { count: "exact", head: true });
  if ((count ?? 0) > 0) { console.log("= gallery: already has images, skipped"); return; }

  console.log("Uploading gallery photos to storage…");

  // -- Event album: Baishakhi celebration ------------------------------------
  const baishakhi = glob(/^event-baishakhi-\d+\.jpg$/i);
  const baishakhiUrls = [];
  for (const f of baishakhi) baishakhiUrls.push(await upload(f));

  // -- Event album: Shining Stars (real topper + achiever portraits) ---------
  const portraits = [...glob(/^topper-\d+\.jpe?g$/i), ...glob(/^achiever-\d+\.jpe?g$/i)];
  const portraitUrls = [];
  for (const f of portraits) portraitUrls.push(await upload(f));

  // -- Standalone categorised photos (no event) ------------------------------
  const standalone = []; // { file, category, alt }
  for (const f of glob(/^campus-photo-\d+\.jpg$/i))
    standalone.push({ file: f, category: "campus", alt: "Campus life at NK Public School, Murlipura" });
  if (has("library.jpg")) standalone.push({ file: "library.jpg", category: "academics", alt: "School library at NK Public School, Murlipura" });
  if (has("science-laboratory.jpg")) standalone.push({ file: "science-laboratory.jpg", category: "academics", alt: "Science laboratory at NK Public School, Murlipura" });
  if (has("art-and-music.jpg")) standalone.push({ file: "art-and-music.jpg", category: "cultural", alt: "Art & music room at NK Public School, Murlipura" });
  if (has("facilities-tuckshop.jpg")) standalone.push({ file: "facilities-tuckshop.jpg", category: "campus", alt: "Canteen & tuck shop at NK Public School, Murlipura" });
  for (const s of standalone) s.url = await upload(s.file);

  console.log(`  uploaded ${baishakhi.length + portraits.length + standalone.length} photos.`);

  // -- Insert gallery_events -------------------------------------------------
  const events = [];
  if (baishakhiUrls.length)
    events.push({
      title: "Baishakhi Celebration",
      description: "Students celebrate the spring harvest festival of Baishakhi with music, dance and colour on the Murlipura campus.",
      event_date: "2024-04-13",
      academic_year: "2024-25",
      cover_image_url: baishakhiUrls[0],
      is_public: true,
      sort_order: 0,
    });
  if (portraitUrls.length)
    events.push({
      title: "Shining Stars — Board Toppers & Achievers",
      description: "Our proud Noblelites — board-exam toppers and award winners whose results have earned NK Public School, Murlipura its reputation for academic excellence since 1985.",
      event_date: "2025-05-15",
      academic_year: "2024-25",
      cover_image_url: portraitUrls[0],
      is_public: true,
      sort_order: 1,
    });

  const eventIdByTitle = {};
  if (events.length) {
    const { data, error } = await supa.from("gallery_events").insert(events).select("id, title");
    if (error) throw new Error(`gallery_events: ${error.message}`);
    for (const e of data) eventIdByTitle[e.title] = e.id;
    console.log(`  + gallery_events: ${data.length}`);
  }

  // -- Insert gallery_images -------------------------------------------------
  const rows = [];
  let order = 0;
  baishakhiUrls.forEach((u, i) =>
    rows.push({ src: u, alt: `Baishakhi celebration at NK Public School, Murlipura (${i + 1})`, category: "cultural", sort_order: order++, gallery_event_id: eventIdByTitle["Baishakhi Celebration"] })
  );
  for (const s of standalone)
    rows.push({ src: s.url, alt: s.alt, category: s.category, sort_order: order++, gallery_event_id: null });
  portraitUrls.forEach((u, i) =>
    rows.push({ src: u, alt: `A Shining Star of NK Public School, Murlipura (${i + 1})`, category: "academics", sort_order: order++, gallery_event_id: eventIdByTitle["Shining Stars — Board Toppers & Achievers"] })
  );

  // Insert in chunks to stay well under any payload limits.
  for (let i = 0; i < rows.length; i += 100) {
    const { error } = await supa.from("gallery_images").insert(rows.slice(i, i + 100));
    if (error) throw new Error(`gallery_images: ${error.message}`);
  }
  console.log(`  + gallery_images: ${rows.length}`);
}

// ───────────────────────────────────────────────────────────────────────────
// 2. Expand student_achievements with the authentic named-topper roster
//    (text cards; image_url null → the section's Award-icon fallback).
// ───────────────────────────────────────────────────────────────────────────
async function seedAchievements() {
  const { data: existing, error: exErr } = await supa
    .from("section_cards").select("name, sort_order").eq("section", "student_achievements");
  if (exErr) throw new Error(`read achievements: ${exErr.message}`);
  const have = new Set((existing ?? []).map((r) => (r.name || "").trim()));
  let order = Math.max(0, ...(existing ?? []).map((r) => r.sort_order ?? 0)) + 1;

  // Authentic, published results (live-inventory.md §"Achievements & Toppers").
  const roster = [
    { name: "Anushka Sharma", title: "100.00% · Class XII Science", year: "2021", description: "Achieved a perfect 100% in the 2021 Senior Secondary board examination." },
    { name: "Nishtha Gupta", title: "100.00% · Class XII Commerce", year: "2021", description: "Achieved a perfect 100% in the 2021 Senior Secondary board examination." },
    { name: "Akshita Verma", title: "100.00% · Class X", year: "2021", description: "Achieved a perfect 100% in the 2021 Secondary board examination." },
    { name: "Aayushi Sharma", title: "100.00% · Class X", year: "2021", description: "Achieved a perfect 100% in the 2021 Secondary board examination." },
    { name: "Ajay Singh", title: "100.00% · Class X", year: "2021", description: "Achieved a perfect 100% in the 2021 Secondary board examination." },
    { name: "Aakash Bansal", title: "100.00% · Class X", year: "2021", description: "Achieved a perfect 100% in the 2021 Secondary board examination." },
    { name: "Vishesh Sharma", title: "98.33% · Class X", year: "2024", description: "Among the school's top scorers in the 2024 Secondary board examination." },
    { name: "Mridul Jangir", title: "97.60% · Class XII Science", year: "2024", description: "Among the school's top scorers in the 2024 Senior Secondary Science stream." },
    { name: "Prashan Choudhary", title: "96.67% · Class X", year: "2022", description: "Among the school's top scorers in the 2022 Secondary board examination." },
    { name: "Ayush Khandelwal", title: "93.40% · Class XII", year: "2012", description: "Secured Rajasthan state merit rank 3 in the Senior Secondary board examination." },
    { name: "Sunil Choudhary", title: "94.17% · Class X", year: "2012", description: "State merit rank 14 — the first blind student to stand in merit in the general category." },
  ];

  const toInsert = roster
    .filter((r) => !have.has(r.name))
    .map((r) => ({
      section: "student_achievements",
      name: r.name,
      title: r.title,
      year: r.year,
      description: r.description,
      image_url: null,
      sort_order: order++,
      is_active: true,
      is_default: true,
      default_snapshot: null,
    }));

  if (!toInsert.length) { console.log("= student_achievements: roster already present, skipped"); return; }
  const { error } = await supa.from("section_cards").insert(toInsert);
  if (error) throw new Error(`student_achievements: ${error.message}`);
  console.log(`  + student_achievements: ${toInsert.length} cards`);
}

// ───────────────────────────────────────────────────────────────────────────
console.log("Seeding authentic live-site content…\n");
await seedGallery();
await seedAchievements();
console.log("\nDone.");
