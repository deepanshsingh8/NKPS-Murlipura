# Deploying to nkpublicschool.org

Go-live runbook for the three apps in this monorepo, written for the current
situation: **the domain's DNS is at besthostservices.com today, and moves to
Cloudflare after 28 September.** The move does not block go-live — nothing here
depends on who hosts the DNS, and [Part B](#part-b--the-cloudflare-move-after-28-september)
covers what to redo when the transfer happens.

> `MODULES.md` contains an older version of this guide written against
> `nkpublicschool.com` and Gmail SMTP. This file supersedes it: the domain is
> `.org` and email goes through Resend.

---

## Why this can't be hosted on besthostservices

besthostservices sells shared cPanel/PHP hosting. These are three **Next.js 16
server applications** — App Router with middleware, server components, API
routes and image optimisation. They need a Node runtime that the host controls,
not a directory of static files dropped into `public_html`. There is no static
export path either: `middleware.ts` (the auth guard), the `/api/*` routes and
every Supabase-backed page render on demand.

So: **besthostservices keeps the domain registration and DNS for now; the sites
run on Vercel.** All you change at besthostservices is a handful of DNS records
pointing the hostnames at Vercel. Nothing is uploaded there.

Vercel's Hobby plan is free but its terms exclude commercial use; a school site
with fee/admissions workflows should be on **Pro ($20/month/member)**.

---

## Target architecture

Three Vercel projects, one Supabase, one domain:

This mirrors the `nkpublicschool.com` (Rajawas) deployment so the two campuses
are operationally identical — same topology, same canonical-host convention,
same email setup, same launch checks. Where a choice was already made for
`.com`, this document follows it rather than re-deciding. The `.com` source
records are `_reference/tasks-rajawas/domain-handover.md` and
`_reference/tasks-rajawas/launch_day_checklist.md`.

| Hostname | Vercel project | Root directory | What it is |
|---|---|---|---|
| `www.nkpublicschool.org` **(canonical)** | `nkps-website` | `apps/website` | Public marketing site |
| `nkpublicschool.org` | `nkps-website` | — | 301 redirect to `www` |
| `cms.nkpublicschool.org` | `nkps-cms` | `apps/cms` | Content management |
| `erp.nkpublicschool.org` | `nkps-erp` | `apps/erp` | Students, exams, fees, portals |

**Canonical host is `www`**, matching `.com`. The apex is added to the same
Vercel project and set to redirect. Keep this consistent — it decides
`NEXT_PUBLIC_SITE_URL`, every canonical tag, the sitemap, and which Search
Console property is primary.

All three build from the same repo and the same `main` branch — one push
redeploys all three. They share one Supabase project, and share the login
session across subdomains via a cookie scoped to `.nkpublicschool.org`.

---

# Part A — go live now (DNS still at besthostservices)

## Step 0 — Verify the branch builds

Already verified on this branch, but re-run before any cutover:

```bash
pnpm install --frozen-lockfile
pnpm run lint
pnpm run typecheck
pnpm run build
```

All four must pass. CI runs the same gates on every PR to `main`.

## Step 1 — Create the three Vercel projects

For each of `nkps-website`, `nkps-cms`, `nkps-erp`:

1. Vercel dashboard → **Add New… → Project** → import `deepanshsingh8/NKPS-Murlipura`.
2. **Project Name**: `nkps-website` / `nkps-cms` / `nkps-erp`.
3. **Framework Preset**: Next.js (auto-detected).
4. **Root Directory**: click *Edit* → `apps/website` / `apps/cms` / `apps/erp`.
   This is the step people miss — the repo root is not a Next.js app, so a
   project left at root will fail to build.
5. **Build & Install commands**: leave every default. Vercel reads the root
   `packageManager` field and runs `pnpm install` across the workspace.
6. **Environment Variables**: add the variables from Step 2 before the first
   deploy, scoped to *Production, Preview, Development*.
7. Deploy. Confirm each one builds and its `*.vercel.app` URL loads.

Get all three green on their Vercel URLs **before** touching DNS. Then
Settings → Git → **Production Branch** = `main`.

## Step 2 — Environment variables

Values live in `.env.example`. Which project needs which:

| Variable | website | cms | erp | Value / note |
|---|:---:|:---:|:---:|---|
| `NEXT_PUBLIC_SUPABASE_URL` | ✅ | ✅ | ✅ | Same in all three |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | ✅ | ✅ | ✅ | Same in all three |
| `SUPABASE_SERVICE_ROLE_KEY` | ✅ | ✅ | ✅ | Server-only, bypasses RLS |
| `NEXT_PUBLIC_WEBSITE_URL` | ✅ | ✅ | ✅ | `https://www.nkpublicschool.org` |
| `NEXT_PUBLIC_CMS_URL` | ✅ | ✅ | ✅ | `https://cms.nkpublicschool.org` |
| `NEXT_PUBLIC_ERP_URL` | ✅ | ✅ | ✅ | `https://erp.nkpublicschool.org` |
| `NEXT_PUBLIC_SITE_URL` | ✅ | – | – | `https://www.nkpublicschool.org` — drives canonicals, sitemap, robots, OG image |
| `RESEND_API_KEY` | ✅ | – | ✅ | See Step 5 |
| `FROM_EMAIL` | ✅ | – | ✅ | `NK Public School <noreply@nkpublicschool.org>` |
| `REPLY_TO_EMAIL` | ✅ | – | ✅ | Where replies land |
| `ADMIN_NOTIFICATION_EMAIL` | ✅ | – | ✅ | Contact-form / registration alerts |
| `ANTHROPIC_API_KEY` | ✅ | – | – | Home-page chatbot; omit to disable |
| `NEXT_PUBLIC_GA_ID` | ✅ | – | – | GA4 ID; blank disables analytics |
| `NEXT_PUBLIC_GSC_VERIFICATION` | ✅ | – | – | Only if verifying Search Console by meta tag |
| `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` | ✅ | – | ✅ | Contact map; ERP transport autocomplete |
| `TRUSTED_IP_HEADER` | ✅ | ✅ | ✅ | `x-vercel-forwarded-for` — see Part B |
| `EXOTEL_*` | – | – | ✅ | Click-to-call; omit to disable |

`NEXT_PUBLIC_SITE_URL` must be `https://www.nkpublicschool.org` — the origin
that doesn't redirect. Point it at the apex and every canonical tag, the
sitemap and `robots.txt` all reference a URL that 301s.

Environment-variable changes **do not apply to existing deployments**. After
editing any of these, trigger a redeploy (Deployments → ⋯ → Redeploy).

## Step 3 — DNS at besthostservices

In each Vercel project → **Settings → Domains**:

- `nkps-website`: add `www.nkpublicschool.org`, then add `nkpublicschool.org`
  and set it to **redirect to `www.nkpublicschool.org` (301)**.
- `nkps-cms`: add `cms.nkpublicschool.org`.
- `nkps-erp`: add `erp.nkpublicschool.org`.

Vercel then shows the exact records to create.

**Copy the values Vercel shows you** — including in preference to the ones in
the `.com` launch checklist. That checklist says `76.76.21.21` and
`cname.vercel-dns.com`, which were correct when `.com` launched in April.
Vercel now assigns per-project records from an anycast pool, so your apex A
record may be something like `216.198.79.1` and your CNAME target something
like `xyz.vercel-dns-016.com`. The old values still resolve, so `.com` needs no
change — but a new project should use what its own dashboard shows.

The shape will be:

| Type | Name / Host | Value | TTL |
|---|---|---|---|
| A | `@` | *(apex IP shown by Vercel)* | lowest offered |
| CNAME | `www` | *(target shown by Vercel)* | lowest offered |
| CNAME | `cms` | *(target shown by Vercel)* | lowest offered |
| CNAME | `erp` | *(target shown by Vercel)* | lowest offered |

In cPanel this is **Domains → Zone Editor → Manage** for nkpublicschool.org.

Notes:

- **Set TTL as low as the panel allows** (300s if offered) a day before
  cutover, so mistakes are cheap to undo.
- **Delete conflicting records first.** Any existing A/AAAA/CNAME on `@`, `www`,
  `cms` or `erp` pointing at the besthostservices server will fight the new
  ones. There's no live site or email on the domain, so there's nothing else to
  preserve here — but do leave any records Resend asks for in Step 5.
- Propagation is usually minutes, up to a few hours. Vercel issues Let's
  Encrypt certificates automatically once the records resolve; "Invalid
  Configuration" on the apex just means DNS hasn't caught up yet.

## Step 4 — Supabase auth configuration

Supabase Studio → **Authentication → URL Configuration**:

1. **Site URL**: `https://www.nkpublicschool.org` (the canonical host)
2. **Redirect URLs**:
   ```
   https://nkpublicschool.org/**
   https://www.nkpublicschool.org/**
   https://cms.nkpublicschool.org/**
   https://erp.nkpublicschool.org/**
   http://localhost:3001/**
   http://localhost:3002/**
   http://localhost:3003/**
   ```
3. **Cookie domain**: `.nkpublicschool.org` — the leading dot matters. Without
   it, a session created on `erp.` is invisible to `cms.` and staff get signed
   out moving between the two.

Then **Authentication → Email Templates**: the confirm-signup, reset-password,
magic-link and invite templates must point at
`https://erp.nkpublicschool.org/auth/callback` — the ERP app owns that route.

Also confirm the six storage buckets exist (`gallery`, `transfer-certificates`,
`site-media`, `staff-photos`, `disclosure-documents`, `avatars`) with the
visibility given in `README.md`, and that at least one `profiles` row has
`role = 'admin'`.

## Step 5 — Resend sender domain

The contact form and every ERP account email go through Resend. Sending as
`noreply@nkpublicschool.org` requires verifying the domain, which adds **more
DNS records at besthostservices**. Do this in the same sitting as Step 3 — it's
the piece most likely to be forgotten until the first contact-form submission
silently fails to deliver.

Resend → Domains → Add Domain → `nkpublicschool.org` → copy the values it shows
into the cPanel zone editor → Verify. Same record shape as `.com`:

| # | Type | Host | Value | Priority | TTL |
|---|---|---|---|---|---|
| 1 | MX | `send.nkpublicschool.org` | `feedback-smtp.<region>.amazonses.com` | 10 | 3600 |
| 2 | TXT | `send.nkpublicschool.org` | `v=spf1 include:amazonses.com ~all` | — | 3600 |
| 3 | TXT | `resend._domainkey.nkpublicschool.org` | *(DKIM key from Resend)* | — | 3600 |
| 4 | TXT | `_dmarc.nkpublicschool.org` | `v=DMARC1; p=none;` | — | 3600 (recommended) |

Note the MX and SPF sit on the **`send.` subdomain**, not the root — that's
Resend's custom return-path, and it's why verifying doesn't disturb root-domain
mail. Nothing is on the root MX today, but keep the `send.` scoping anyway: it
matches `.com` and stays out of the way if school mailboxes are added later.
The From address is still `@nkpublicschool.org`.

Verify delivery the way `.com` was verified — send to an external address, then
check *Show original* in Gmail for `dkim=pass`, `spf=pass`, the right `From:`,
and the right `Reply-To:`.

## Step 6 — Smoke test

With a fresh browser session, in order:

- [ ] `https://www.nkpublicschool.org` loads over HTTPS with a valid certificate
- [ ] The apex `https://nkpublicschool.org` 301s to `www`
- [ ] Navigation, gallery and about pages render; images load from Supabase
- [ ] Home page loads with no console errors (F12 → Console)
- [ ] Every public page loads: `/about`, `/academics`, `/admissions`,
      `/student-life`, `/facilities`, `/gallery`, `/articles`, `/contact`,
      `/transfer-certificates`, `/mandatory-public-disclosure`, `/for-parents`
- [ ] Footer phone numbers are `tel:` links; email links open a mail client
- [ ] Contact-page map embed loads and is pinned correctly
- [ ] `/robots.txt` and `/sitemap.xml` both show `www.nkpublicschool.org` URLs —
      not `nkpsmurlipura.com` and not the `*.vercel.app` URL
- [ ] Contact form submits and the email actually arrives
- [ ] `https://cms.nkpublicschool.org/login` → admin login → dashboard works
- [ ] `https://erp.nkpublicschool.org/login` → admin login → students/exams work
- [ ] Log into ERP, then open the CMS in the same tab — already authenticated
      (this is the cookie-domain check from Step 4)
- [ ] Portal forgot-password email arrives and its link signs the user in
- [ ] An editor with CMS-only permissions is bounced from `erp.*`
- [ ] `https://www.nkpublicschool.org/admin/gallery` redirects to the CMS

Also confirm no dev-only indexing guards survived: no `robots: { index: false }`
in the website's `layout.tsx`, and no `noIndex: true` left in any page's
`buildMetadata({...})`.

## Step 7 — SEO, analytics and social (launch day)

Mirrors §5–§9 of the `.com` launch checklist. Do these once the domain resolves.

**Structured data + metadata**
- [ ] View source on `/` — the `application/ld+json` graph shows
      `www.nkpublicschool.org` URLs, not the Vercel URL
- [ ] `/opengraph-image` returns a 1200×630 branded PNG showing the right
      hostname in its footer
- [ ] Run `/` and `/admissions` through
      [Rich Results Test](https://search.google.com/test/rich-results)

**Google Search Console**
- [ ] Add property → URL prefix → `https://www.nkpublicschool.org`
- [ ] Verify by HTML tag — set `NEXT_PUBLIC_GSC_VERIFICATION` to the token only
      (not the whole `<meta>` tag), then **redeploy** before verifying
- [ ] Submit `sitemap.xml`
- [ ] Request indexing on `/`, `/admissions`, `/about`, `/academics`, `/contact`
- [ ] Add the apex property too, so both are tracked

**Google Analytics 4**
- [ ] Confirm `NEXT_PUBLIC_GA_ID` is set, then open the live site and check
      GA4 → Reports → Realtime shows an active user within ~30s
- [ ] GA4 Admin → Data Streams → stream URL is `https://www.nkpublicschool.org`
- [ ] Link GA4 ↔ Search Console

**Social previews** — validate with the
[Facebook debugger](https://developers.facebook.com/tools/debug/),
[LinkedIn Post Inspector](https://www.linkedin.com/post-inspector/), and by
sending the URL to yourself on WhatsApp.

**Performance baseline** — run
[PageSpeed Insights](https://pagespeed.web.dev/) on `/`, `/admissions` and
`/contact` and record LCP/INP/CLS, same as `.com`, so the two campuses are
comparable. Targets: mobile Performance ≥ 70, LCP < 2.5s, CLS < 0.1,
Accessibility ≥ 90, SEO = 100.

> Off-site work (Google Business Profile, directory listings with consistent
> NAP, the weekly article cadence) is §10–§12 of the `.com` checklist. It's not
> deployment, but it's what actually earns rankings — worth running the same
> playbook for Murlipura with its own GBP listing and address.

## Rollback

- **A build broke**: Vercel → Deployments → last green deploy → *Promote to
  Production*. Each project rolls back independently.
- **Auth broken across subdomains**: revert the cookie-domain change first —
  it's the usual culprit. The symptom is being signed out on every hop between
  subdomains.
- **DNS wrong**: with a 300s TTL you can simply correct the record. This is why
  Step 3 lowers TTL in advance.

---

# Part B — the Cloudflare move (after 28 September)

Transferring the domain to Cloudflare changes **who answers DNS queries**, not
where the sites run. Vercel, Supabase and Resend are untouched.

This is the same destination `.com` is headed for (`domain-handover.md` §5:
Tradelit → Cloudflare), so both campuses end up with school-controlled DNS on
one Cloudflare account. `.org` is the easier of the two — you already hold the
domain access, whereas `.com` is gated behind a reseller (Wolkgeist) for the
registrar and a separate vendor (Tradelit) for DNS. Doing `.org` first is a
low-risk rehearsal for the `.com` move.

1. **Before starting**, export or screenshot the full zone from cPanel. You are
   about to recreate every record.
2. Add the domain in Cloudflare → it scans the existing zone and imports what
   it can find. **Verify record by record against your export** — the scan
   routinely misses TXT records, which is exactly where Resend's SPF and DKIM
   live. Missing DKIM = email starts failing silently, days later.
3. Update the nameservers at the registrar to Cloudflare's pair.
4. Set the encryption mode to **Full (Strict)**. Cloudflare's default
   "Flexible" mode in front of Vercel causes infinite redirect loops, because
   Vercel already forces HTTPS.
5. **Set the proxy status to DNS-only (grey cloud) for all four records.**
   Vercel is already a global CDN with its own edge cache and certificates;
   stacking Cloudflare's proxy in front adds a second cache to reason about and
   is a common source of stale-content and certificate problems. Turn the
   orange cloud on later, deliberately, only if you want something Cloudflare
   specifically provides (WAF rules, bot management).
6. If you *do* enable the orange cloud, change `TRUSTED_IP_HEADER` to
   `cf-connecting-ip` in all three Vercel projects and redeploy — otherwise
   rate limiting sees Cloudflare's IPs instead of the visitor's and throttles
   everyone as one client.
7. Re-run the Step 6 smoke test, plus a contact-form submission to confirm
   email survived the zone move.

Do the move on a quiet weekday morning, not a Friday evening.

---

## Day-2 operations

Push to `main` → all three projects rebuild and deploy in parallel. PRs get
per-app preview deployments automatically, and CI runs lint + typecheck +
build on every one.
