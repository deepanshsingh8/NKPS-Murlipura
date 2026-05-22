# NKPS Murlipura — Migration TODO

Cloned from the NKPS Rajawas codebase with deep-green theme and Murlipura
branding. The Rajawas reference codebase, scraped source content and original
task logs are all under `_reference/`.

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
