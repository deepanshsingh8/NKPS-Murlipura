# NKPS Modules

NKPS is a turborepo with three independent Next.js apps and one shared package.
The repo can be deployed in three productization tiers:

| Tier | Apps deployed | Suitable for |
|---|---|---|
| **Website** | `apps/website` + `packages/shared` | School with a public site, no admin |
| **Website + CMS** | `apps/website` + `apps/cms` + `packages/shared` | School that wants content management (gallery, articles, TC uploads, contact) |
| **Website + CMS + ERP** | All three apps + `packages/shared` | Full school management (students, exams, fees, timetable, attendance, portal/teacher/student/parent dashboards) |

## Repo layout

```
.
├── apps/
│   ├── website/           ← public marketing site                (subdomain: nkps.com)
│   │   └── src/
│   │       ├── app/       ← public routes (/, /about, /academics, …)
│   │       ├── components/ ← website-only React components
│   │       └── lib/       ← website-only data helpers (site-media, disclosure)
│   │
│   ├── cms/               ← content management (subdomain: cms.nkps.com)
│   │   └── src/
│   │       ├── app/       ← admin routes (/, /articles, /gallery, /contact, …)
│   │       ├── components/ ← CmsSidebar
│   │       ├── proxy.ts   ← CMS auth gate (admin/editor only)
│   │       └── …
│   │
│   └── erp/               ← school operations (subdomain: erp.nkps.com)
│       └── src/
│           ├── app/
│           │   ├── (admin)/   ← admin pages with sidebar (/, /people, /exams, …)
│           │   ├── portal/    ← portal login + password flows
│           │   ├── teacher/   ← teacher dashboard
│           │   ├── student/   ← student dashboard
│           │   ├── parent/    ← parent dashboard
│           │   ├── auth/      ← Supabase auth callbacks
│           │   └── api/       ← all ERP + portal + staff API routes
│           ├── components/    ← ErpSidebar, dialogs, bulk uploads, pdf/, etc.
│           ├── lib/           ← ERP business logic (final-result, fees, grading, …)
│           └── proxy.ts       ← ERP auth gate (multi-role)
│
├── packages/
│   └── shared/            ← code consumed by every app
│       └── src/
│           ├── components/ ← ui primitives, providers, sidebar shell, dashboard view
│           ├── lib/        ← Supabase clients, validations, email, permissions, utils
│           ├── hooks/      ← useUnreadCount, useMousePosition
│           └── types/      ← TypeScript types
│
├── pnpm-workspace.yaml    ← declares apps/* and packages/* as workspaces
├── turbo.json             ← build/dev/lint pipelines
├── eslint.config.mjs      ← module-boundary enforcement
└── supabase-schema.sql    ← consolidated DB schema (see DB section below)
```

## Module-boundary enforcement

ESLint blocks cross-app imports. Each app can only import from itself + `@nkps/shared/*`. There's no path between, e.g., `apps/website` and `apps/cms` — the only way they share code is through `packages/shared`.

Run `pnpm run lint` to verify. Zero violations is the goal.

## Database modules

Run the corresponding sections from `supabase-schema.sql` for the tier you want.
Historical, applied-in-order migrations live under `scripts/migrations/{base,cms,erp,cross}/`
— see [`scripts/migrations/README.md`](scripts/migrations/README.md) for the
per-tier apply order.

### Base (every deployment)
Required for auth, profiles, and calendar:

| Table | Purpose |
|---|---|
| `profiles` | Per-user role + display info (mirrors `auth.users`) |
| `editor_permissions` | Per-feature CMS/ERP grants for editor role |
| `calendar_events` | Public school calendar (academic-calendar page reads it) |
| `notifications` | Cross-module notification fanout |

### CMS (Tier 2+)
Adds content-management tables: `gallery_images`, `gallery_events`, `articles`, `site_media`, `section_cards`, `transfer_certificates`, `contact_submissions`, `disclosure_items`, `disclosure_documents`, `disclosure_board_results`, `staff_members`.

Storage buckets: `gallery`, `transfer-certificates`, `site-media`, `staff-photos`, `disclosure-documents`.

### ERP (Tier 3)
Adds `academic_years`, `streams`, `classes`, `subjects`, `class_subjects`, `stream_subjects`, `students`, `student_subjects`, `student_enrollments`, `parents`, `student_parents`, `teachers`, `attendance`, `exam_types`, `exam_schedules`, `result_masters`, `result_master_subjects`, `class_grade_scales`, `grade_scales`, `grade_bands`, `class_exam_configs`, `results`, `marksheet_publications`, `class_tests`, `class_test_results`, `non_scholastic_*`, `student_remarks`, `ptm_notes`, `ptm_formats`, `supplementary_attempts`, `fee_structures`, `fee_payments`, `payment_orders`, `timetable_periods`, `substitutions`, `teacher_absences`, `school_meeting_counts`, `pdf_header_configs`, `pdf_footer_configs`, `admit_card_templates`, `registration_requests`, `publish_events`.

Storage bucket: `avatars`.

### Cross-module FKs

- `transfer_certificates.student_id` → `students(id)` (ON DELETE SET NULL — TCs survive student deletion). For CMS-only deployments, skip the FK constraint.
- `staff_members` rows can be linked to `teachers` in ERP deployments.

## Local development

```bash
# install once
pnpm install

# run a single app (each on its own port)
pnpm run dev:website    # → http://localhost:3001
pnpm run dev:cms        # → http://localhost:3002
pnpm run dev:erp        # → http://localhost:3003

# run all three concurrently via turbo
pnpm run dev

# build all three
pnpm run build

# typecheck and lint
pnpm run typecheck
pnpm run lint
```

Each app needs its own `.env.local` with `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`. For local dev, symlink them all to a root `.env.local`:
```bash
ln -sf ../../.env.local apps/website/.env.local
ln -sf ../../.env.local apps/cms/.env.local
ln -sf ../../.env.local apps/erp/.env.local
```

## Production deployment (subdomains)

Each app is its own Vercel project on its own subdomain, all pointing at the same Supabase. Setup is one-time; after that, every push to `main` auto-deploys all three apps.

| Subdomain | Vercel project | Root directory |
|---|---|---|
| `nkpublicschool.com` | `nkps-website` | `apps/website` |
| `cms.nkpublicschool.com` | `nkps-cms` | `apps/cms` |
| `erp.nkpublicschool.com` | `nkps-erp` | `apps/erp` |

### Environment variable reference

Per-app required vars. Missing one will either fail the build or break a runtime feature.

| Variable | website | cms | erp | Notes |
|---|:---:|:---:|:---:|---|
| `NEXT_PUBLIC_SUPABASE_URL` | ✅ | ✅ | ✅ | Same value in all three projects |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | ✅ | ✅ | ✅ | Same value in all three projects |
| `SUPABASE_SERVICE_ROLE_KEY` | ✅ | ✅ | ✅ | Same value in all three projects |
| `NEXT_PUBLIC_WEBSITE_URL` | ✅ | ✅ | ✅ | `https://nkpublicschool.com` |
| `NEXT_PUBLIC_CMS_URL` | ✅ | ✅ | ✅ | `https://cms.nkpublicschool.com` |
| `NEXT_PUBLIC_ERP_URL` | ✅ | ✅ | ✅ | `https://erp.nkpublicschool.com` |
| `NEXT_PUBLIC_SITE_URL` | ✅ | – | – | Public canonical URL (`https://nkpublicschool.com`) — used for SEO, sitemap, JSON-LD |
| `ANTHROPIC_API_KEY` | ✅ | – | – | Chatbot on the public site |
| `NEXT_PUBLIC_GA_ID` | ✅ | – | – | GA4 measurement ID; leave blank to disable |
| `NEXT_PUBLIC_GSC_VERIFICATION` | ✅ | – | – | Search Console meta-tag verification token (only if verifying via tag) |
| `GMAIL_USER` | ✅ | – | ✅ | Gmail address used for SMTP |
| `GMAIL_APP_PASSWORD` | ✅ | – | ✅ | Gmail app password (not the account password) |
| `FROM_EMAIL` | ✅ | – | ✅ | `NK Public School <noreply@…>` — must use the `GMAIL_USER` mailbox |
| `REPLY_TO_EMAIL` | ✅ | – | ✅ | Where replies route (e.g. `nkps.rajawas@gmail.com`) |

Why each app sends mail:
- **website** — public contact form (`apps/website/src/app/api/contact/route.ts`).
- **erp** — portal forgot-password, register, registration approve/reject.
- **cms** — does not send mail directly; only manages submissions.

> Note: production uses Gmail SMTP via `nodemailer` (see `packages/shared/src/lib/email.ts`). `RESEND_API_KEY` mentioned in some older notes is not used.

---

### Step 0 — Before merging to main

Verify the branch is deployable.

```bash
pnpm install --frozen-lockfile
pnpm run lint
pnpm run typecheck
pnpm exec turbo run build
```

All four must pass. CI (`.github/workflows/ci.yml`) runs the same gates on PRs to `main`.

Also make sure no uncommitted changes are sitting in your working tree (`git status`).

### Step 1 — Create the two new Vercel projects (cms, erp)

Do this **before** merging. Both projects can be pointed at the `phase-3-monorepo` branch first so you can preview-deploy and verify before they ever touch production.

For each new project (`nkps-cms` and `nkps-erp`):

1. Vercel dashboard → **Add New… → Project** → import this GitHub repo.
2. **Project Name**: `nkps-cms` or `nkps-erp`.
3. **Framework Preset**: Next.js (auto-detected).
4. **Root Directory**: `apps/cms` or `apps/erp` (use the "Edit" link next to Root Directory).
5. **Build & Output Settings**: leave defaults — Vercel uses `next build` from the app's `package.json`, and pnpm workspaces are auto-detected.
6. **Install Command**: leave blank — Vercel honours the root `packageManager` field and runs `pnpm install` against the workspace.
7. **Production Branch** (Project → Settings → Git): `main`.
8. **Environment Variables**: add every variable in the column for that app from the table above. Set the scope to *Production, Preview, Development*.
9. Deploy from the `phase-3-monorepo` branch as a preview. Confirm it builds.

### Step 2 — Repoint the existing Vercel project to `apps/website`

The current production project (the one serving `nkpublicschool.com`) builds from the repo root. After the merge, root is no longer a Next.js app, so **the existing project will fail to build** unless its Root Directory is updated.

Two safe approaches — pick one:

**Approach A (recommended): change Root Directory just before the merge.**
1. Existing Vercel project → Settings → General → **Root Directory** → `apps/website` → Save.
2. Settings → Git → **Production Branch** = `main` (likely already is).
3. Settings → Environment Variables → add the website-column vars from the table above (the existing project already has Supabase/Anthropic/GA vars; just add the missing cross-app URL vars: `NEXT_PUBLIC_WEBSITE_URL`, `NEXT_PUBLIC_CMS_URL`, `NEXT_PUBLIC_ERP_URL`, plus `GMAIL_USER`, `GMAIL_APP_PASSWORD`, `FROM_EMAIL`, `REPLY_TO_EMAIL` if not already present).
4. Don't trigger a deploy yet — the merge in Step 5 will trigger it.

**Approach B (zero-risk, slightly more work):** create a brand-new `nkps-website` project the same way as Step 1 (root = `apps/website`), assign it the apex domain after Step 5, and delete the old project once verified.

### Step 3 — Set up DNS for the new subdomains

In whatever DNS provider hosts `nkpublicschool.com`, add:

| Type | Name | Value |
|---|---|---|
| CNAME | `cms` | `cname.vercel-dns.com` |
| CNAME | `erp` | `cname.vercel-dns.com` |

Then in each Vercel project → Settings → Domains, add `cms.nkpublicschool.com` (to `nkps-cms`) and `erp.nkpublicschool.com` (to `nkps-erp`). Vercel will issue SSL certs automatically once DNS propagates (a few minutes to an hour).

### Step 4 — Configure Supabase for cross-subdomain auth

In Supabase Studio → **Authentication → URL Configuration**:

1. **Site URL**: `https://nkpublicschool.com`
2. **Additional Redirect URLs** (one per line):
   ```
   https://nkpublicschool.com/**
   https://cms.nkpublicschool.com/**
   https://erp.nkpublicschool.com/**
   http://localhost:3001/**
   http://localhost:3002/**
   http://localhost:3003/**
   ```
3. **Cookie domain**: `.nkpublicschool.com` (leading dot — required so the auth cookie set on one subdomain is readable from the others).

In Supabase Studio → **Authentication → Email Templates**, update the link in each template (Confirm signup, Reset password, Magic link, Invite user) to use:
```
https://erp.nkpublicschool.com/auth/callback?...
```
The ERP app owns the `/auth/callback` route. If you currently use the default `{{ .SiteURL }}/auth/callback`, change `SiteURL` references to the literal ERP URL, or update the Site URL above to the ERP subdomain (only if your password-reset/signup flows live exclusively in ERP, which they do today).

### Step 5 — Merge `phase-3-monorepo` → `main`

```bash
git checkout main
git pull
git merge --no-ff phase-3-monorepo
git push origin main
```

This single push triggers all three Vercel projects to build and deploy in parallel.

### Step 6 — Smoke test

In order, with a fresh browser session:

- [ ] `https://nkpublicschool.com` loads, navigation works, gallery + about pages render
- [ ] Public contact form submits successfully and an email lands in the configured inbox
- [ ] `https://cms.nkpublicschool.com/login` loads → log in as admin → CMS dashboard renders, gallery/articles/contact lists work
- [ ] `https://erp.nkpublicschool.com/login` loads → log in as admin → ERP dashboard renders, students/exams pages work
- [ ] Log into ERP, then open `https://cms.nkpublicschool.com` in the same tab — you should already be authenticated (cross-subdomain cookie working). If not, recheck the cookie domain in Step 4.
- [ ] Trigger a portal forgot-password — the email link points to `https://erp.nkpublicschool.com/auth/callback…` and successfully signs the user in.
- [ ] Editor login: an editor account with only CMS permissions can access cms.* but is bounced from erp.*, and vice versa.

### Step 7 — Optional: legacy URL redirects

External bookmarks and old crawler URLs may still hit the apex domain at `/admin/...`, `/cms/...`, `/erp/...`, or `/portal/...`. Add `apps/website/vercel.json` to send them to the right subdomain:

```json
{
  "redirects": [
    { "source": "/admin/login", "destination": "https://erp.nkpublicschool.com/login", "permanent": true },
    { "source": "/admin/articles", "destination": "https://cms.nkpublicschool.com/articles", "permanent": true },
    { "source": "/admin/gallery", "destination": "https://cms.nkpublicschool.com/gallery", "permanent": true },
    { "source": "/admin/(.*)", "destination": "https://erp.nkpublicschool.com/$1", "permanent": true },
    { "source": "/cms", "destination": "https://cms.nkpublicschool.com", "permanent": true },
    { "source": "/cms/(.*)", "destination": "https://cms.nkpublicschool.com/$1", "permanent": true },
    { "source": "/erp", "destination": "https://erp.nkpublicschool.com", "permanent": true },
    { "source": "/erp/(.*)", "destination": "https://erp.nkpublicschool.com/$1", "permanent": true },
    { "source": "/portal/(.*)", "destination": "https://erp.nkpublicschool.com/portal/$1", "permanent": true }
  ]
}
```

Commit + push — the website project picks it up on the next deploy. Not on the critical path for go-live.

### Rollback

If something goes wrong post-merge:

- **Build broke on one project**: in Vercel → Deployments → previous green deploy → "Promote to Production". Each project rolls back independently.
- **Auth broken across subdomains**: revert the Supabase cookie-domain change first (it's the most common breaker). Cookie domain mismatches manifest as users being signed out on every navigation between subdomains.
- **Need to fully revert the merge**: `git revert -m 1 <merge-sha>` on `main`. The three projects will redeploy the pre-merge website code; cms/erp projects will fail their next build (no `apps/cms` / `apps/erp` exists on pre-merge `main`) — pause those projects in Vercel until the next forward fix.

### Day-2 operations

After the initial cutover, deploys are normal: push to `main`, all three projects rebuild. Per-app preview deploys run on PRs automatically. Use feature branches; CI will run lint + typecheck + build for all three apps on every PR.

## Adding a new feature

When adding a feature, decide which app it belongs to:

- **Public-facing display only?** → `apps/website`
- **Content management (admin can create/edit articles, gallery, etc.)?** → `apps/cms`
- **School operations (students, staff, exams, fees, portal)?** → `apps/erp`
- **Used by ≥ 2 apps?** → `packages/shared`

If a feature spans apps (e.g., a CMS-managed banner that the website displays), put the read function in `packages/shared/src/lib/` and the management UI in `apps/cms`.
