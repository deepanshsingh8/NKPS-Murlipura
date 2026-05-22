# Launch Day Checklist — NK Public School

Everything that must happen the day `nkpublicschool.com` goes live. Work top to bottom. Add items as we discover them.

---

## 1. DNS + Domain

- [ ] Decide canonical host: **`www.nkpublicschool.com`** (recommended — matches current defaults in `src/lib/seo.ts` and sitemap).
- [ ] In the domain registrar, point DNS to Vercel:
  - [ ] Add A record for apex `nkpublicschool.com` → `76.76.21.21` (Vercel's IP, confirm in Vercel dashboard).
  - [ ] Add CNAME for `www` → `cname.vercel-dns.com`.
- [ ] Wait for DNS propagation (5 min – 24 h). Verify with `dig www.nkpublicschool.com` or https://dnschecker.org.
- [ ] In Vercel → Project → **Settings → Domains**:
  - [ ] Add `www.nkpublicschool.com`.
  - [ ] Add `nkpublicschool.com` and set it to **redirect to** `www.nkpublicschool.com` (301).
  - [ ] Confirm SSL certificate is issued (green check, takes ~1 min after DNS resolves).
- [ ] Open `https://www.nkpublicschool.com` in incognito — site loads, HTTPS padlock is valid.

## 2. Environment variables (Vercel Production)

- [ ] Set `NEXT_PUBLIC_SITE_URL=https://www.nkpublicschool.com`.
- [ ] Confirm `NEXT_PUBLIC_GA_ID=G-XXXXXXXXXX` is set (should already be there).
- [ ] Set `NEXT_PUBLIC_GSC_VERIFICATION=<content-value-from-GSC-HTML-tag>` (the token, not the full `<meta>` tag).
- [ ] **Redeploy** — env var changes don't take effect until a fresh deployment. Vercel → Deployments → ⋯ → Redeploy.

## 3. Remove any dev-only guards

- [ ] If `robots: { index: false, follow: false }` was added to `src/app/layout.tsx` during development, **flip back to `true`**. Commit + push.
- [ ] Confirm no page.tsx has `noIndex: true` left over in `buildMetadata({...})`.

## 4. Smoke test on the live domain

- [ ] Homepage `/` loads, HeroSlider plays, no console errors (F12 → Console).
- [ ] All 10 public pages load: `/about`, `/academics`, `/admissions`, `/student-life`, `/facilities`, `/gallery`, `/contact`, `/transfer-certificates`, `/articles`, `/mandatory-public-disclosure`.
- [ ] Contact form submits successfully (check the admin dashboard for the submission).
- [ ] Admin login works at `/admin/login`.
- [ ] All phone numbers in footer are `tel:` links that open the dialer on mobile.
- [ ] All email links open the mail client.
- [ ] Map embed on `/contact` loads and is correctly pinned on Grand Sikar Road.

## 5. SEO verification

- [ ] View source on `/` — find `application/ld+json`. Should see the `EducationalOrganization`+`LocalBusiness`+`Place` graph with `www.nkpublicschool.com` URLs (not Vercel URL).
- [ ] View source on `/admissions` — should see `FAQPage` JSON-LD with 7 Q&As.
- [ ] View source on `/contact` — should see `FAQPage` JSON-LD with 4 Q&As.
- [ ] `https://www.nkpublicschool.com/sitemap.xml` — lists all 11 URLs, each with `<lastmod>`, all pointing at `www.nkpublicschool.com`.
- [ ] `https://www.nkpublicschool.com/robots.txt` — allows `/`, disallows `/admin` and `/api`, references sitemap.
- [ ] `https://www.nkpublicschool.com/opengraph-image` — returns a 1200×630 branded PNG.
- [ ] Paste homepage URL into https://search.google.com/test/rich-results — `EducationalOrganization` + `LocalBusiness` detected, eligible.
- [ ] Paste `/admissions` into Rich Results Test — `FAQPage` detected, eligible for FAQ rich result.
- [ ] Paste `/articles/<any-slug>` (once at least one article exists) — `NewsArticle` detected.

## 6. Google Search Console

- [ ] Go to https://search.google.com/search-console, signed in as `nkps.rajawas@gmail.com`.
- [ ] Add property → URL prefix → `https://www.nkpublicschool.com`.
- [ ] Verify ownership (HTML tag method should succeed since the token is now live in the page head).
- [ ] **Submit sitemap**: Sidebar → Sitemaps → enter `sitemap.xml` → Submit. Status should read *Success* within a few minutes.
- [ ] **Request indexing** on each high-value page (URL Inspection → paste URL → Request indexing):
  - [ ] `/`
  - [ ] `/admissions`
  - [ ] `/about`
  - [ ] `/academics`
  - [ ] `/contact`
- [ ] Also verify the `nkpublicschool.com` (non-www) property so both are tracked.

## 7. Google Analytics 4

- [ ] Open the live site in a new tab. In GA4 → Reports → Realtime → confirm 1 active user appears within ~30 seconds.
- [ ] In GA4 admin → **Data Streams** → confirm stream URL is `https://www.nkpublicschool.com` (not the Vercel URL).
- [ ] Link GA4 ↔ Search Console (GA4 Admin → Product links → Search Console Links → Link). Enables organic-search reporting inside GA4.
- [ ] Enable Google signals (GA4 Admin → Data Settings → Data Collection) for richer demographic data.

## 8. Social share preview validation

- [ ] Facebook debugger: https://developers.facebook.com/tools/debug/ → paste `https://www.nkpublicschool.com/` → Scrape Again. Preview should show the branded OG image + correct title + description.
- [ ] Twitter/X Card validator: https://cards-dev.twitter.com/validator (if still available) or post a test tweet with the URL and verify the card renders.
- [ ] LinkedIn post inspector: https://www.linkedin.com/post-inspector/ → paste URL → Inspect.
- [ ] WhatsApp: send `https://www.nkpublicschool.com/` to yourself in a chat — preview should show OG image + title.

## 9. Performance + accessibility baseline

- [ ] Run PageSpeed Insights on `/`, `/admissions`, `/contact`: https://pagespeed.web.dev/. Record baseline numbers (LCP, INP, CLS) for later comparison. Target: mobile Performance ≥ 70, LCP < 2.5s, CLS < 0.1.
- [ ] Run Lighthouse in Chrome DevTools (mobile) — check Accessibility ≥ 90, SEO = 100.
- [ ] Fix anything flagged as a ranking signal (missing alts, contrast issues, tap target size).
- [ ] Mobile-friendly test: https://search.google.com/test/mobile-friendly → should pass.

## 10. Tier 3 (off-site — not code, but the real ranking fight)

*These are the ones that actually win "best school in Jaipur". Do not skip.*

- [ ] **Google Business Profile** — claim / verify the listing at https://business.google.com for `NK Public School` on Grand Sikar Road. Complete every field (hours, categories, services, photos). Post at least once a week.
- [ ] Upload ≥ 30 photos to GBP (campus exterior, interior, facilities, events, students in uniform with consent, staff).
- [ ] Ask every parent at the next PTM for a Google review. Target 50+ reviews averaging 4.5+ within 90 days.
- [ ] List on directories with **identical** Name/Address/Phone (NAP consistency matters):
  - [ ] Justdial
  - [ ] Sulekha
  - [ ] SchoolMyKids
  - [ ] Edustoke
  - [ ] UrbanPro
  - [ ] IndiaMart education listing
  - [ ] Bing Places (https://www.bingplaces.com)
  - [ ] Apple Maps Connect (https://mapsconnect.apple.com)
- [ ] Set up social media posting cadence: 1 Instagram post/week, 1 Facebook post/week minimum. Tag location = Jaipur.
- [ ] Reach out to local education journalists / blogs for annual-day coverage (earns backlinks).

## 11. Tier 2 content plan (ongoing, weekly)

*Long-tail rankings come from regular publishing. Infrastructure is already built at `/admin` → Articles.*

- [ ] Publish first article within 48 hours of launch (e.g., "Welcome to the new NKPS website").
- [ ] Commit to **1 article/week** for the first 12 weeks. Suggested topics:
  - CBSE board-exam prep tips for Class X / XII
  - Admissions 2026–27 guide for parents in Jaipur
  - What to look for in a CBSE school in North Jaipur
  - Annual Sports Day / Annual Day recaps (earns shares + backlinks)
  - Alumni achievement features
  - Faculty spotlights (builds E-E-A-T signals)
- [ ] Each article ≥ 600 words, includes at least one image with descriptive alt text, uses H2/H3 structure, links internally to 2 other pages.
- [ ] Update the hero slider in `/admin` to use the new keyword-focused titles (the defaults now say "Best CBSE School in Jaipur" but DB-added cards override — check whatever is seeded).

## 12. Post-launch — first 30 days

- [ ] **Week 1**: Daily check of GSC → Coverage report for crawl errors. Fix immediately.
- [ ] **Week 2**: Check GSC → Performance tab. First queries should appear. Note top 10 queries and positions as baseline.
- [ ] **Week 4**: Run PageSpeed Insights again, compare to launch-day baseline. Fix any regressions.
- [ ] **Week 4**: Ensure at least 4 articles published. Check GSC for which have been indexed.
- [ ] **Week 4**: Check GBP insights — search impressions, direction requests, calls.

---

## Things we haven't decided yet

- [ ] Final SSL/TLS config — Vercel auto-handles, but if we add Cloudflare later, enable Full (strict) SSL mode.
- [ ] Whether to add a cookie consent banner (India isn't GDPR-regulated but it's good practice if international visitors are expected).
- [ ] Whether to set up Vercel Speed Insights (paid) for real-user Core Web Vitals — decision deferred until we see baseline numbers.

---

*Last updated: 2026-04-22. Add items above this line, keep the checklist fresh.*
