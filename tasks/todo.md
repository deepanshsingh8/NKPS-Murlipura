# NKPS Murlipura — Migration TODO

Cloned from the NKPS Rajawas codebase with deep-green theme and Murlipura
branding. The Rajawas reference codebase, scraped source content and original
task logs are all under `_reference/`.

---

## SEO improvement pass (2026-10-01) — Phase A implemented on `claude/seo-phase-a`

Audit = live crawl of https://www.nkpublicschool.org + code review of
`apps/website`. Raw crawl output: session scratchpad `seo-live/`.

### Checklist status (user's list)
| Item | Status today |
|---|---|
| Server-side rendering | ✅ mostly — ❌ `/gallery`, staff list on `/academics`, home events fetched client-only |
| sitemap.xml | ⚠️ works, but `/academic-calendar` missing; static `lastmod` = build time; built once per deploy so new articles don't appear until redeploy |
| Search Console | ✅ done by user — confirm "Success" + discovered-URL count in GSC |
| Googlebot not blocked | ✅ robots.txt only blocks /admin /cms /erp /api; same HTML for Googlebot |
| No stray noindex | ✅ none on public pages — ❌ ERP login (`erp.` subdomain) *is* indexable, should be noindex |
| Redirect chains | ✅ all 308, one hop for www/https; apex+trailing-slash = 2 hops (Vercel domain config, minor) |
| Canonical tags | ✅ self-canonical everywhere — ❌ 404 + "article not found" inherit canonical `/` from root layout |
| Fix 404s | ✅ no broken internal links — ❌ article JSON-LD publisher logo `/logo.png` is a 404 |
| Meta descriptions | ✅ unique on all pages — ⚠️ 11/18 over 160 chars; titles 66–95 chars with brand repeated twice |
| One H1 per page | ✅ exactly one everywhere — ⚠️ home H1 rotates with hero slide and renders at opacity:0 |
| FAQ schema | ✅ on /admissions + /contact — ❌ answers not in HTML (closed accordion unmounts them) |
| Breadcrumbs | ✅ most pages — ❌ for-parents, prospectus, holiday-homework, MPD, article pages |
| Orphan pages | ❌ /alumni (no server-HTML link), /articles + /academic-calendar only linked from home |
| Image alt text | ✅ all images have alt (1 decorative empty) — gallery alt comes from DB |
| Images → WebP | ✅ next/image serves WebP — ⚠️ 5 `fill` images lack `sizes` (oversized downloads) |
| Layout shift | ⚠️ unmeasured (PageSpeed API quota 0) — big risk is opacity:0 animation on hero/H1 delaying LCP |
| Load < 2s | ⚠️ unmeasured; TTFB 0.17–0.53s (good); ~362 KB JS on home from site-wide chalk effects + framer-motion |
| Author bio | ⚠️ leadership content exists, no Person schema; article `author` always typed Organization |
| Forbes backlink | ❌ not achievable via code — see Phase C for realistic link building |

Also found: **`/articles/nkps-murlipura-2025-board-results` shows the "Smart
Panel Classrooms" article** (CMS data mismatch); sports article has no
og:image; `sameAs` social links + affiliation number empty in schema.

### Phase A — code (one branch → PR, Vercel preview verified)
- [x] A0 Baseline Lighthouse 13 (mobile, local prod builds of `main` vs branch — PageSpeed web/API quota-blocked from here)
- [x] A1 sitemap: add `/academic-calendar`; drop fake `now` lastmod; revalidate hourly so new articles appear; thin pages auto-excluded (A9)
- [x] A2 Titles ≤ 60 chars (no double brand), descriptions ≤ 160 chars
- [x] A3 Remove inherited root canonical; fix 404 duplicate robots meta; "article not found" no canonical
- [x] A4 Article pages: logo → `/images/logo.png`, fallback og:image, consistent siteName, `Person` author when named, visible breadcrumb + BreadcrumbList
- [x] A5 BreadcrumbList on for-parents, prospectus, holiday-homework, MPD
- [x] A6 Server-render gallery, staff directory, home events, and /academic-calendar (was dynamic via cookie client → now ISR)
- [x] A7 FAQ / MPD accordions: keep answers in the DOM (`keepMounted`/hidden-until-found)
- [x] A8 Internal links: alumni, articles, academic-calendar in footer (server HTML)
- [x] A9 Prospectus / holiday-homework: `noindex` + out of sitemap while empty, auto-indexed once CMS has content
- [x] A10 LCP: hero image + H1 visible on first paint (no opacity:0 start); stable home H1 (school name), slide titles → h2
- [x] A11 Images: `sizes` on grid `fill` images; navbar logo eager; `priority` → `preload` (Next 16). AVIF skipped on purpose (webp-only keeps Vercel image-transform quota low, see next.config.ts); PNG source left — next/image serves WebP anyway
- [x] A12 Perf: measured — TBT ≤ 52 ms and chalk effects already desktop-only, so no deferral needed; fixed opacity-gated LCP on /about + /gallery instead
- [x] A13 ERP + CMS: noindex meta + `X-Robots-Tag` header; robots.txt *allows* crawling so Google can see the noindex
- [x] A14 Leadership `Person` schema on /about (author/E-E-A-T)
- [x] A15 Verify: website/ERP/CMS builds ✅, typecheck + lint ✅, crawl of prod build ✅, Lighthouse A/B ✅ — Rich Results Test to run on the Vercel preview

### Phase A results (local prod builds, Lighthouse 13 mobile / simulated slow 4G)
| Page | LCP main → branch | Perf main → branch |
|---|---|---|
| / | 6.25 s → 4.06 s | 78 → 87 |
| /about | 4.53 s → 3.76 s | 84 → 89 |
| /gallery | 4.37 s → 3.99 s | 85 → 87 |
| /admissions | 4.97 s → 4.66 s | 82 → 83 |
CLS 0.000 and SEO 100 on every run; TBT ≤ 35 ms. Remaining LCP floor is the
critical path on slow 4G (CSS + 2 web fonts + framer-motion JS); getting it
under ~3 s needs a bigger refactor (trim framer-motion / client components).
Tried `loading="eager"` + `fetchPriority="high"` instead of `preload` on hero
images — slightly worse (4.06 → 4.21 s), reverted.

Crawl of branch build: every page 1 h1, title ≤ 60, description ≤ 160,
self-canonical, no "Loading…" placeholders; FAQ answers in the DOM; 404 only
`noindex` (no canonical); /prospectus + /holiday-homework `noindex, follow` and
out of the sitemap while empty; ERP /portal/login → `X-Robots-Tag` + meta noindex.

Flagged, not changed (product decisions):
- ~~/admissions pop-up auto-opened 600 ms after every visit~~ — fixed (user
  approved): opens once per session after scrolling half a viewport, and its
  form code is lazy-loaded. Plus `AnimatedSection aboveFold` on the first
  section of 10 pages. /admissions LCP 4.97 s → 3.76 s, perf 82 → 89.
- Student Life activity names in the CMS look like placeholders
  ("Sports-Indoor-1", "Sports-Outdoor") — rename in CMS.
- ~~Footer office hours 8 AM vs 9 AM~~ — fixed: footer now reads
  `SCHOOL.officeHours` (Mon–Sat, 9:00 AM – 3:00 PM, confirmed by user).
- Lighthouse a11y flags colour contrast (96/100) — not SEO, worth a pass later.

### Phase B — content / data (needs school input)
- [x] B1 Board-results article → slug renamed to `smart-panel-classrooms` (DB) + 308 redirect (vercel.json)
- [x] B2 Social profile URLs → constants + school_profile.social + `sameAs`
- [x] B3 RBSE affiliation number 1121353 → constants, school_profile, MPD "Affiliation No." (MPD "School Code" still empty)
- [ ] B4 Upload prospectus PDF + holiday homework (school) — gallery alt text ✅ (17 placeholder alts rewritten + recategorised)
- [ ] B5 Expand thin /student-life copy

### Phase C — off-site (user)
- [ ] C1 GSC: sitemap status, Pages report (indexed vs excluded), URL Inspection → request indexing on key pages
- [ ] C2 Google Business Profile (biggest lever for "school in Murlipura / Jaipur" searches): verify, photos, hours, link to site
- [ ] C3 Links: other NKPS campus sites → Murlipura; education directories (Shiksha, Edustoke, Justdial, Sulekha); local press (Dainik Bhaskar / Rajasthan Patrika) for results & sports wins; alumni + staff LinkedIn
- [ ] C4 Publish an article monthly (results, events, admissions) — fresh, linkable content

---

## Launch-parity completion pass (2026-07-14) — DONE

Verified the launch-parity plan (Website + CMS). Findings + finishing work:

**Already complete (commit bff82e8):** NewsAchievements homepage block, /alumni
page (200, graceful empty state), VisionMission on /about, admissions enquiry
modal, conditional social links (no empty `href=""`), `next.config.ts` image
optimization (WebP + long cache) and full CSP/security headers, Murlipura
content in `constants.ts`, CMS site-media editor parity, zero Rajawas /
1730406 / Grand Sikar / 20,000 strings in website+shared.

**Database (Supabase now resumed — was paused/521):**
- section_cards = 30 rows: hero_slider(3, real banner images), facilities(6),
  why_choose_us(4), legacy_timeline(5), leadership(3, real portraits),
  accolades(3), student_achievements(6). articles = 3. All 6 storage buckets
  exist; hero/leadership images resolve (200) and serve as WebP.
- Left unseeded on purpose: testimonials / activities / annual_events /
  campus_facilities seeds (051/057/058) reference stripped `/images/gallery/st*`
  + `/images/news/n*` files → would show broken images; these sections
  `return null` when empty, so they hide cleanly. alumni intentionally unseeded.
- **Created first admin user** (deepanshsingh8@gmail.com, role=admin,
  must_change_password=true) — auth.users was empty; CMS was unloginable.

**Fixed this pass:** `sitemap.ts` was missing `/alumni` (Workstream G) — added.

**Verified:** website + CMS `build` exit 0; lint 0 errors (16 pre-existing
warnings, unrelated files); all 11 public routes 200; homepage renders all
seeded sections; CSP + HSTS + X-Frame-Options headers present; hero served as
image/webp; sitemap now lists /alumni; robots targets nkpsmurlipura.com.

**Still needs the school (content confirmation, non-blocking):** CBSE
affiliation number, exact pin code, fee structure, real testimonials/events/
staff roster, active social handles — all currently TODO(content) placeholders
or gracefully hidden.

---

## Chalkboard theme rollout (in progress — 2026-07-14)

Full-site blackboard + chalk re-skin (approved direction). Gaegu chalk font,
site-wide chalk cursor, worksheet-card readability pattern, real photos styled
as pinned notices.

**Done & build-verified:**
- [x] Foundation: Gaegu font (`--font-chalk`), chalkboard tokens + utility
      classes (`.site-chalk`, `.chalk-heading`, `.chalk-underline`,
      `.chalk-frame`/`.chalk-inboard`, `.chalk-card`, `.worksheet`, `.photo-pin`,
      `.btn-chalk`) in `globals.css`.
- [x] `ChalkCursor` component + mounted in `LayoutShell` (public pages only).
- [x] Global chrome: TopBar, Navbar, Footer → chalkboard.
- [x] Homepage fully converted: Hero, intro, marquee, QuickLinks,
      FacilitiesPreview, NewsAchievements (→ framed Notice Board), StatsCounter,
      SchoolEvents, Testimonials.

**Next (after homepage review):**
- [ ] Convert remaining 16 pages: about, academics, admissions, alumni,
      facilities, student-life, gallery, contact, prospectus, holiday-homework,
      transfer-certificates, for-parents, articles, academic-calendar,
      mandatory-public-disclosure + their component dirs (about/, academics/,
      admissions/).
- [ ] Check contact form / any inputs under the chalk cursor.
- [ ] Production licensing note: Gaegu is OFL (safe, self-hosted via next/font).

---

## Completed in this clone

- [x] Copy NKPS monorepo into project root (apps/website, apps/cms, apps/erp,
      packages/shared, scripts/, etc.).
- [x] Replace Royal Blue palette with Forest Emerald + Gold in `globals.css`
      across all 3 apps. Tailwind token names kept (`navy-*`, `blue-*`) so
      existing class usage continues to work.
- [x] Replace hard-coded SVG fills in `apps/erp/src/app/(admin)/fees/_components/TransportSlabsMap.tsx`.
- [x] Rewrite `packages/shared/src/lib/constants.ts` with Murlipura address,
      phones, emails, founder, MD/Director/Principal. `STAFF` arrays left empty
      — populate via CMS or constants.
- [x] Drop in scraped Murlipura logo + favicon. Replace code-default hero,
      gallery and news fallback images with the four scraped Murlipura
      banners. Delete the rest of the Rajawas placeholders.
- [x] Update SEO across `/about`, `/contact`, `/admissions`, `/gallery`,
      `/articles`, `/transfer-certificates`, `/mandatory-public-disclosure`,
      home page, opengraph-image, robots, sitemap default URL.
- [x] Rewrite chatbot system prompt in `apps/website/src/app/api/chat/route.ts`
      for Murlipura (founding campus, scholarship + admission policy, no
      hard-coded teacher list).
- [x] `.env.example` and `.env.local` cleared of Rajawas Supabase keys.
      Murlipura-specific FROM_EMAIL and cross-app URL placeholders set.
- [x] Compile `supabase-schema.sql` as a structure-only DDL (all 50 seed
      INSERTs stripped). Original Rajawas-seeded schema kept at
      `_reference/supabase-schema-rajawas-full.sql`.

## Next steps — you (user) must do these

1. **Create a fresh Supabase project** for Murlipura (separate from Rajawas).
   - Region: closest to Jaipur (Mumbai, ap-south-1).
   - Save project URL + anon key + service-role key.
2. **Apply the schema.** Paste `supabase-schema.sql` into the Supabase SQL
   editor and run. This creates all 67 tables, indexes, RLS policies,
   functions and triggers with **no seed data**.
3. **Create the storage buckets** (Supabase dashboard → Storage):
   - `gallery` (public read)
   - `transfer-certificates` (private)
   - `site-media` (public read)
   - `staff-photos` (public read)
   - `disclosure-documents` (public read)
   - `avatars` (public read)
   Buckets are referenced by `packages/shared/src/lib/supabase/upload.ts` and
   admin upload routes — without them, image upload from the CMS will fail.
4. **Fill `.env.local`** with the new Supabase keys, Resend API key (if you
   want emails), Anthropic API key (if you want the chatbot), and Google Maps
   API key.
5. **Install + run:**
   ```bash
   pnpm install
   pnpm dev:website   # localhost:3001
   pnpm dev:cms       # localhost:3002
   pnpm dev:erp       # localhost:3003
   ```
6. **Create the first admin user.** In the Supabase dashboard → Authentication
   → Users → "Add user", then in SQL editor run:
   ```sql
   UPDATE profiles SET role = 'admin' WHERE email = 'your@email.com';
   ```
7. **Populate via CMS** at `localhost:3002`:
   - Upload site-media (hero slider, section banners, founder photo, etc.).
   - Add staff members in the directory.
   - Publish articles/news.
   - Add gallery photos.
8. **Confirm before publishing:** the affiliation board (CBSE/RBSE),
   affiliation number, exact postal pin code (302032 vs 302039), current
   principal, fee structure and active social handles. The scrape captured
   Murlipura's content as of 2026-05-22, but several of those items diverge
   from the Rajawas branch on `nkpublicschool.com` and need school
   confirmation.

## Optional follow-ups

- Replace `nkpsmurlipura.com` placeholder domain everywhere once the real
  domain is decided (search-and-replace across `*.tsx`, `*.ts`, `.env*`).
- Update the founder portrait at `/images/about/rk-choudhary.png` — currently
  the Rajawas asset; same person, but the CMS can override with a higher-res
  version uploaded to the `site-media` bucket.
- Adjust `geo` coordinates in `packages/shared/src/lib/constants.ts` once the
  exact Arya Nagar pin is known (currently set to an approximate Murlipura
  centroid).
- Tighten the Forest Emerald palette if the design feels off after first dev
  run — values are in `apps/{website,cms,erp}/src/app/globals.css` lines 20–30.
