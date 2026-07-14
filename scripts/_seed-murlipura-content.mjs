// Seed Murlipura launch content into a fresh Supabase project via the service
// role (PostgREST + Storage). Idempotent: each section is only seeded when it
// has no rows yet; images upsert. Run:
//   node --env-file=.env.local scripts/_seed-murlipura-content.mjs
//
// Content is Murlipura-verifiable (scrape §1–§8). Sections we cannot honestly
// seed (testimonials, alumni) are intentionally skipped — they render a
// graceful empty state. accolades/student_achievements are DDL-gated (see
// migration-061) and handled separately.
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) { console.error("Missing Supabase env"); process.exit(1); }
const supa = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });

const ASSETS = new URL("../_reference/scraped/assets/", import.meta.url);
const BUCKET = "site-media";

async function upload(localName, destPath, contentType) {
  const buf = readFileSync(new URL(localName, ASSETS));
  const { error } = await supa.storage.from(BUCKET).upload(destPath, buf, { contentType, upsert: true });
  if (error && !`${error.message}`.includes("exists")) throw new Error(`upload ${destPath}: ${error.message}`);
  return supa.storage.from(BUCKET).getPublicUrl(destPath).data.publicUrl;
}

async function count(section) {
  const { count } = await supa.from("section_cards").select("*", { count: "exact", head: true }).eq("section", section);
  return count ?? 0;
}

async function seedSection(section, rows) {
  if (await count(section) > 0) { console.log(`  = ${section}: already has rows, skipped`); return; }
  const payload = rows.map((r, i) => ({ section, sort_order: i, is_active: true, is_default: true, ...r }));
  const { error } = await supa.from("section_cards").insert(payload);
  if (error) throw new Error(`seed ${section}: ${error.message}`);
  console.log(`  + ${section}: ${rows.length} cards`);
}

// ---- 1. Upload images -------------------------------------------------------
console.log("Uploading images to storage…");
const hero1 = await upload("banner1.jpg", "hero/banner1.jpg", "image/jpeg");
const hero2 = await upload("banner2.jpg", "hero/banner2.jpg", "image/jpeg");
const hero3 = await upload("banner3.jpg", "hero/banner3.jpg", "image/jpeg");
const hero4 = await upload("banner4.jpg", "hero/banner4.jpg", "image/jpeg");
const md = await upload("md-lunayach.png", "leadership/md-lunayach.png", "image/png");
const director = await upload("director-kuldeep.jpg", "leadership/director-kuldeep.jpg", "image/jpeg");
const principal = await upload("principal-basera.jpg", "leadership/principal-basera.jpg", "image/jpeg");
console.log("  images uploaded.");

// ---- 2. site_media slots ----------------------------------------------------
console.log("Seeding site_media…");
const mediaRows = [
  { slot: "hero_slide_1", page: "home", section: "hero", label: "Hero Slide 1", current_url: hero1, default_url: hero1, alt_text: "NK Public School, Murlipura campus", sort_order: 0 },
  { slot: "hero_slide_2", page: "home", section: "hero", label: "Hero Slide 2", current_url: hero2, default_url: hero2, alt_text: "Students at NK Public School, Murlipura", sort_order: 1 },
  { slot: "hero_slide_3", page: "home", section: "hero", label: "Hero Slide 3", current_url: hero3, default_url: hero3, alt_text: "NK Public School, Murlipura learning environment", sort_order: 2 },
  { slot: "stats_background", page: "home", section: "stats", label: "Stats Background", current_url: hero4, default_url: hero4, alt_text: "", sort_order: 3 },
  { slot: "about_hero", page: "about", section: "hero", label: "About Hero", current_url: hero2, default_url: hero2, alt_text: "NK Public School, Murlipura — Arya Nagar campus", sort_order: 4 },
  { slot: "founder_photo", page: "about", section: "founder", label: "Founder Photo", current_url: "/images/about/rk-choudhary.png", default_url: "/images/about/rk-choudhary.png", alt_text: "Late Shri R.K. Choudhary, Founder", sort_order: 5 },
];
{
  const { error } = await supa.from("site_media").upsert(mediaRows, { onConflict: "slot" });
  if (error) throw new Error(`site_media: ${error.message}`);
  console.log(`  + site_media: ${mediaRows.length} slots`);
}

// ---- 3. section_cards -------------------------------------------------------
console.log("Seeding section_cards…");

await seedSection("hero_slider", [
  { title: "The Founding NKPS Campus", subtitle: "Nurturing young minds in Murlipura, Jaipur since 1985", cta_text: "Explore Admissions", cta_link: "/admissions", image_url: hero1 },
  { title: "Knowledge, Discipline & Values", subtitle: "English-medium, co-educational learning from Nursery to Class XII", cta_text: "About Our School", cta_link: "/about", image_url: hero2 },
  { title: "Science & Commerce Streams", subtitle: "Preparing students for board excellence and beyond", cta_text: "Our Academics", cta_link: "/academics", image_url: hero3 },
]);

await seedSection("facilities_preview", [
  { title: "Well-Stocked Library", description: "Over 3,000 books, periodicals, encyclopedias and journals in a calm reading environment that encourages learning beyond the curriculum.", icon: "BookOpen", image_url: null },
  { title: "Science Laboratories", description: "Dedicated Physics, Chemistry and Biology labs where theory is reinforced with regular hands-on practicals under trained instructors.", icon: "FlaskConical", image_url: null },
  { title: "Smart Classrooms", description: "Technology-enabled classrooms that make everyday learning interactive, visual and engaging for every student.", icon: "Monitor", image_url: null },
  { title: "Art, Music & Dance", description: "Fine art, screen and commercial art, plus music and dance traditions from across India, taught by specialist faculty.", icon: "Palette", image_url: null },
  { title: "Safe School Transport", description: "Bus service across the city at nominal charges, with well-maintained routes and a focus on student safety.", icon: "Bus", image_url: null },
  { title: "Canteen & Tuck Shop", description: "A hygienic on-campus canteen and a nearby tuck shop for stationery and healthy snacks.", icon: "Utensils", image_url: null },
]);

await seedSection("why_choose_us", [
  { title: "Four Decades of Legacy", description: "As the founding NKPS campus, we have educated students in Northern Jaipur since 1985 on our founder's ideals of discipline, knowledge and human values.", icon: "Award" },
  { title: "Experienced Faculty", description: "A dedicated team of educators committed to academic rigour and the all-round development of every child.", icon: "BookOpen" },
  { title: "CBSE Curriculum", description: "A structured co-educational programme from Nursery to Class XII, with Science and Commerce streams at the senior-secondary level.", icon: "Monitor" },
  { title: "Character & Discipline", description: "A pastoral, values-led environment where freedom is exercised through discipline and every student is guided to reach their potential.", icon: "Trophy" },
]);

await seedSection("legacy_timeline", [
  { year: "1985", title: "A Vision Takes Root", description: "NK Public School is founded in Arya Nagar, Murlipura by Late Shri R.K. Choudhary, beginning with just 10 students." },
  { year: "1990s", title: "Steady Growth", description: "The school grows in strength and reputation, becoming a trusted name for English-medium education in Northern Jaipur." },
  { year: "2005", title: "The Founder's Legacy", description: "After the founder's passing, the school continues on his ideals of discipline, education and human values." },
  { year: "2021", title: "Board Excellence", description: "Students achieve perfect 100% scores in the Secondary and Senior Secondary board examinations." },
  { year: "2025", title: "State Merit Rankers", description: "Students secure Rajasthan state merit ranks in the Class X and Class XII board examinations." },
]);

await seedSection("leadership", [
  { name: "Dr. N.C. Lunayach", designation: "Managing Director", role: "Managing Director", initials: "NL", image_url: md, message: "It is not enough if you just live life as it comes to you like a floating leaf in a pond. Make use of the powers bestowed upon you and soar like an eagle. Every day and every morning begins with a different challenge." },
  { name: "Mr. Kuldeep Singh", designation: "Director", role: "Director", initials: "KS", image_url: director, message: "NKPS is a voyage of discovery — of one's talent and potential, of opportunities and challenges. The wealth of a nation is not dependent on economic resources alone; education is the foundation that builds confident, ethical, independent citizens." },
  { name: "Ms. Chitra Raje Basera", designation: "Principal", role: "Principal", initials: "CB", image_url: principal, message: "A relentless quest for excellence, an insatiable thirst for knowledge and a limitless craving for the latest are the hallmarks of NKPS. Freedom can only be effectively exercised when guided by discipline." },
]);

// ---- 4. articles ------------------------------------------------------------
console.log("Seeding articles…");
async function seedArticles() {
  const { count } = await supa.from("articles").select("*", { count: "exact", head: true });
  if ((count ?? 0) > 0) { console.log("  = articles: already present, skipped"); return; }
  const now = new Date().toISOString();
  const rows = [
    {
      slug: "nkps-murlipura-2025-board-results",
      title: "NKPS Murlipura Students Shine in the 2025 Board Results",
      excerpt: "Our students secured Rajasthan state merit ranks in the Class X and Class XII board examinations.",
      content: "We are proud to celebrate another year of outstanding board results at NK Public School, Murlipura.\n\nKashvi Sharma scored 99.00% in Class XII Commerce, securing a state merit rank of 2. Divyanshi Gupta scored 98.67% in Class X, earning a Rajasthan state merit rank of 8, and Ansh Mishra scored 97.00% in Class XII Science.\n\nThese results reflect the dedication of our students, the commitment of our faculty and the values of discipline and hard work that have defined NKPS since 1985. We congratulate every student and wish them the very best for the journey ahead.",
      author_name: "NKPS Murlipura",
      is_published: true, published_at: now, tags: ["Results", "Academics"],
    },
    {
      slug: "nkps-murlipura-national-sports-champions",
      title: "National Sports Champions from NKPS Murlipura",
      excerpt: "Students win gold at national-level shooting, grappling and Pencak Silat championships.",
      content: "Sport and physical education are an integral part of life at NK Public School, Murlipura.\n\nOur students have brought home gold medals from national-level competitions — including the National Shooting Championship, the National Grappling Championship and the Pencak Silat Junior National Championship.\n\nThese achievements are a testament to the discipline, determination and all-round development we nurture in every child, on the field as much as in the classroom.",
      author_name: "NKPS Murlipura",
      is_published: true, published_at: now, tags: ["Sports", "Achievements"],
    },
    {
      slug: "admissions-open-2026-27",
      title: "Admissions Open for the 2026–27 Academic Session",
      excerpt: "Applications are invited for Nursery to Class XII at the founding NKPS campus in Murlipura, Jaipur.",
      content: "Admissions are now open for the 2026–27 academic session at NK Public School, Murlipura.\n\nWe welcome applications from Nursery to Class XII, with Science and Commerce streams available at the senior-secondary level. Our admissions process is simple and transparent, with priority given to local residents and a 25% reservation under the RTE Act in Nursery and Class I.\n\nTo learn more or begin your application, please visit our Admissions page or contact the school office. We look forward to welcoming your child to the NKPS family.",
      author_name: "NKPS Murlipura",
      is_published: true, published_at: now, tags: ["Admissions"],
    },
  ];
  const { error } = await supa.from("articles").insert(rows);
  if (error) throw new Error(`articles: ${error.message}`);
  console.log(`  + articles: ${rows.length}`);
}
await seedArticles();

console.log("\nDone. Skipped (TODO content): testimonials, alumni, calendar_events.");
console.log("DDL-gated (run migration-061 first): accolades, student_achievements.");
