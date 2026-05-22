# CMS / ERP Split — Concrete Plan

## Vision (productization end-state)

Three independently deployable modules so we can sell:
- **Website-only** — public site, no admin
- **Website + CMS** — public site with content management (gallery, articles, TC uploads, contact)
- **Website + CMS + ERP** — full school management (everything above + students, exams, fees, timetable, attendance, etc.)

Each module is a separately buildable Next.js app sharing a `@nkps/shared` package (Supabase clients, types, UI primitives, auth helpers). Same Supabase project per deployment, but module-specific schema groups (CMS tables vs ERP tables vs base tables).

## Phasing strategy

The end-state is a **monorepo with three apps**, but jumping there in one shot would break the live system. We phase it:

| Phase | What | Effort | Outcome |
|---|---|---|---|
| **Phase 0** | Public-site UX changes (QuickLinks rework, `/academic-calendar` page) | 1–2 hrs | Visible improvement, zero risk |
| **Phase 1** | Route-group split: `/cms/*` and `/erp/*` URLs in same app | 4–6 days | Two distinct admin experiences, same deploy |
| **Phase 2** | Module boundaries: enforce no cross-imports, extract `src/shared/` | 3–5 days | Code separated; ready for extraction |
| **Phase 3** | Monorepo: turborepo/pnpm workspaces, three Next.js apps, three deploys | 1–2 wks | True productization — sellable as standalone modules |

Phase 0 is being executed today. Phases 1–3 require explicit go-aheads and run across multiple sessions with commits at each safe checkpoint.

---

## Phase 0 — Public-site UX (this session)

- [x] Update `QuickLinks.tsx`: replace 4-card layout (Student Portal / Staff Portal / Downloads / Academic Calendar) with 3-card layout (ERP Login / CMS Login / Academic Calendar)
  - ERP Login → `/portal/login` (multi-role; redirects post-login by role)
  - CMS Login → `/admin/login` (admin/editor only — currently merged with ERP staff login; will diverge in Phase 1)
  - Academic Calendar → `/academic-calendar` (new page)
- [x] Build `src/app/academic-calendar/page.tsx` — public page listing upcoming `calendar_events` grouped by month, with type-color badges. Replaces the broken `/academics` link target.
- [x] Verify build passes (`npm run build` — `/academic-calendar` listed as dynamic route)
- [ ] Smoke test on dev server (user to confirm visual / navigation)

Top Navbar "ERP" link is left alone (already at `/erp-login` → `/portal/login`).

---

## Phase 1 — Route-group split ✅ COMPLETE

> Goal: in the same Next.js app, split `/admin/*` into `/cms/*` and `/erp/*` route groups with separate sidebars, layouts, and dashboards.

**Status:** Done. All admin routes relocated under `/cms/*` and `/erp/*`, both modules have distinct login pages, sidebars, layouts, and dashboards. CMS-side admin APIs renamed to `/api/cms/*`. `/admin/*` → 301 redirects in `next.config.ts`. `npm run build` clean.

**Decisions locked in:**
- Two distinct login pages: `/cms/login` (admin/editor only) + `/erp/login` (multi-role)
- URL scheme: `/cms/*` + `/erp/*` (top-level)
- Permanent 301 redirects from `/admin/*`
- API rename: `/api/admin/{articles,site-media,section-cards,disclosure-documents,upload-url}` → `/api/cms/*`. Cross-cutting (`/api/admin/dashboard`, `/api/admin/editor-permissions`) kept as-is. Public website APIs (`/api/contact`, `/api/gallery`, `/api/transfer-certificates`) unchanged.

## Why this is tractable
The codebase is already conceptually split:
- `FeatureDef` already carries `group: "content" | "erp"` (`src/lib/permissions.ts:43`).
- `AdminSidebar` already has separate `contentLinks` and `erpItems` arrays (`src/components/admin/AdminSidebar.tsx:66, 84`).
- Permissions are feature-keyed, not section-keyed, so revoking ERP from a CMS-only editor is already a no-op.
- API routes are already separated under `/api/erp/*` vs `/api/gallery|contact|transfer-certificates/*`.

The split is mostly URL relocation + sidebar/layout duplication, not architectural surgery.

## Open decisions (need user input before implementation)

1. **One shared login page or two?**
   - **One** (recommended): single `/staff/login` page; post-login redirect based on role + which side they came from (via `?next=/cms` or `?next=/erp` query). Simpler, less code.
   - **Two**: cosmetic `/cms/login` and `/erp/login` pages — visually distinct, but same auth backend. Pure aesthetics.
2. **URL scheme:** `/cms/*` + `/erp/*` (recommended — clean, short) **or** `/admin/cms/*` + `/admin/erp/*` (preserves `/admin` as ancestor)?
3. **Old `/admin/*` URLs:** permanent 301 redirects to new homes (recommended) or hard-delete and let bookmarks 404?

---

## Implementation phases

### Phase 1 — Permissions & path scheme (foundation)
- [ ] Update `FeatureDef.href` values in `src/lib/permissions.ts:52-82` from `/admin/...` to `/cms/...` or `/erp/...`
- [ ] Update `ADMIN_ONLY_PREFIXES` (`src/lib/permissions.ts:96-103`) to new ERP paths
- [ ] Add helper `featureGroupForPath(pathname): "cms" | "erp" | null`
- [ ] Add helper `loginPathForGroup(group): string` (returns `/cms/login` or `/erp/login` or shared)

### Phase 2 — Middleware rewrite
- [ ] Rewrite `src/lib/supabase/middleware.ts:25-29` `isProtectedRoute` to check `/cms` + `/erp` instead of `/admin`
- [ ] Update unauthenticated redirect target (line 73) to choose `/cms/login` vs `/erp/login` based on requested path
- [ ] Replace `pathname.startsWith("/admin")` editor checks (lines 117, 126) with `/cms` + `/erp` equivalents
- [ ] Cross-side bouncing for editors: if editor with only CMS perms hits `/erp/*`, redirect to `/cms`
- [ ] Update `middleware.ts:9-21` matcher: replace `/admin/:path*` and `/api/admin/:path*` with `/cms/:path*`, `/erp/:path*`, `/api/cms/:path*` (already have `/api/erp/:path*`)

### Phase 3 — Sidebar + layout split
- [ ] Create `src/components/cms/CmsSidebar.tsx` — copy `AdminSidebar`, keep only `contentLinks`, drop ERP section, change header label "NKPS CMS"
- [ ] Create `src/components/erp/ErpSidebar.tsx` — same copy, keep only `erpItems`, header label "NKPS ERP"
- [ ] Optional refactor: extract a shared `<AdminSidebarShell>` so the two new sidebars don't duplicate 400+ lines of rendering code. Recommended.
- [ ] Create `src/app/cms/layout.tsx` rendering `<CmsSidebar>`
- [ ] Create `src/app/erp/layout.tsx` rendering `<ErpSidebar>`
- [ ] Create `src/app/cms/page.tsx` (CMS-scoped dashboard — counts: pending contact messages, gallery item count, recent articles)
- [ ] Create `src/app/erp/page.tsx` (ERP-scoped dashboard — counts: students, pending registrations, upcoming exams)

### Phase 4 — Move route directories
- [ ] `src/app/admin/content/*` → `src/app/cms/content/*` (or flatten — `/cms/gallery` reads better than `/cms/content/gallery`)
- [ ] `src/app/admin/transfer-certificates/*` → `src/app/cms/transfer-certificates/*`
- [ ] `src/app/admin/contact/*` → `src/app/cms/contact/*`
- [ ] `src/app/admin/academics/*` → `src/app/erp/academics/*`
- [ ] `src/app/admin/attendance/*` → `src/app/erp/attendance/*`
- [ ] `src/app/admin/calendar/*` → `src/app/erp/calendar/*`
- [ ] `src/app/admin/exams/*` → `src/app/erp/exams/*`
- [ ] `src/app/admin/fees/*` → `src/app/erp/fees/*`
- [ ] `src/app/admin/people/*` → `src/app/erp/people/*`
- [ ] `src/app/admin/registrations/*` → `src/app/erp/registrations/*`
- [ ] `src/app/admin/timetable/*` → `src/app/erp/timetable/*`

### Phase 5 — Internal href updates (the tedious part)
- [ ] `grep -rn "/admin/" src/` and update every internal `<Link href>`, `router.push`, server-action `redirect()`, API JSON `redirect_url`, etc.
- [ ] Pay special attention to: dashboard widgets, breadcrumbs, bulk-action redirects, post-create navigations, error fallback routes.
- [ ] Update `src/lib/verify-admin.ts:148` if it references admin paths.
- [ ] Add Next.js redirects in `next.config.js`:
  ```js
  redirects: async () => [
    { source: "/admin", destination: "/cms", permanent: true },
    { source: "/admin/login", destination: "/cms/login", permanent: true },
    { source: "/admin/content/:path*", destination: "/cms/:path*", permanent: true },
    { source: "/admin/exams/:path*", destination: "/erp/exams/:path*", permanent: true },
    // ... one entry per moved subtree
  ]
  ```

### Phase 6 — Login pages
Pick from Open Decision #1:
- **If shared:** create `src/app/staff/login/page.tsx` accepting `?next=` query, redirect old `/admin/login` to it.
- **If split:** clone `src/app/admin/login/page.tsx` to `src/app/cms/login/page.tsx` and `src/app/erp/login/page.tsx`. Each posts to Supabase and lands on its own dashboard.

### Phase 7 — Public website buttons
- [ ] Identify Navbar / footer login link locations (likely `src/components/layout/Navbar.tsx`, possibly Footer).
- [ ] Replace single "Admin Login" with two buttons: "CMS" → `/cms/login`, "ERP" → `/erp/login` (or one "Staff" → chooser).

### Phase 8 — API routes (optional symmetry)
- [ ] Decide whether to rename `/api/gallery`, `/api/contact`, `/api/transfer-certificates` to `/api/cms/*` for symmetry with `/api/erp/*`. Pure cosmetics — skip if it adds risk. If skipped, document the asymmetry.
- [ ] `/api/admin/dashboard` and `/api/admin/editor-permissions` stay where they are (cross-cutting concerns).

### Phase 9 — Delete + verify
- [ ] Once new tree is fully wired, delete old `src/app/admin/` (except possibly a stub `page.tsx` that 301s to `/cms`).
- [ ] Update `CLAUDE.md` and `AGENTS.md` to reflect the new architecture.
- [ ] Update editor-permissions admin UI labels if they reference `/admin/...` paths.

### Phase 10 — Smoke tests
- [ ] Admin: log in via `/cms/login` → land on `/cms`, sidebar shows CMS only. Navigate to `/erp` directly → allowed (admin sees both sides).
- [ ] Editor with CMS-only perms: log in → land on `/cms`. Try `/erp/exams/results` → redirected to `/cms`.
- [ ] Editor with ERP-only perms: log in via either side → land on `/erp`.
- [ ] Editor with mixed perms: lands on requested side, can navigate the other side via direct nav.
- [ ] Old `/admin/exams/results` URL → redirects to `/erp/exams/results`.
- [ ] Public site CMS / ERP buttons land on respective login pages.

---

## File-level effort estimate

| Area | Files touched | Effort |
|---|---|---|
| Permissions catalog | `src/lib/permissions.ts` | 30 min |
| Middleware | `src/lib/supabase/middleware.ts`, `middleware.ts` | 1 hr |
| Sidebar split (with shared shell) | 3 files | 2–3 hrs |
| New layouts + dashboards | 4 files | 3 hrs |
| Folder moves (`mv` + import-path tweaks) | ~80 page files | half day |
| Internal href grep+replace | ~150 occurrences | 4 hrs |
| Login page(s) | 1–2 files | 1 hr |
| Public site buttons | 1–2 files | 30 min |
| `next.config.js` redirects | 1 file | 30 min |
| Smoke testing | — | half day |
| Docs | `CLAUDE.md`, `AGENTS.md` | 30 min |

**Total: ~4–6 working days** for a single developer, sequential. Can be parallelized somewhat by doing Phase 3 (sidebar) and Phase 4 (route moves) concurrently.

---

## Risks & mitigations

- **Stale internal links** — easy to miss a `<Link href="/admin/...">` deep in some component. Mitigation: build a comprehensive grep-replace map; ship `/admin/*` redirects so misses don't 404.
- **Supabase auth cookie scope** — single domain, single cookie. No issue. Logging in once gives access to both sides.
- **Editor sessions in flight at deploy time** — they'll land on `/admin/*`, hit redirect, end up on the right side. Seamless.
- **Bookmark / external link breakage** — covered by 301 redirects in `next.config.js`. Keep them for at least a release cycle.
- **Linter / type-check noise** — moving files with circular imports occasionally breaks. Plan for one round of `npm run build` cleanup after Phase 4.

---

## Decision required before starting Phase 1
1. Single shared login or two cosmetic logins?
2. URL scheme: `/cms` + `/erp` or `/admin/cms` + `/admin/erp`?
3. Keep redirects forever or drop them after a deprecation window?
4. Rename `/api/gallery` etc. to `/api/cms/*` for symmetry, or leave alone?

Once these are answered, Phase 1 is ready to execute.

---

## Phase 2 — Module boundaries (after Phase 1)

> Goal: prove modules can stand alone *within* the codebase. No code outside `src/shared/` may import from outside its module folder.

- [ ] Restructure: `src/website/`, `src/cms/`, `src/erp/`, `src/shared/`
- [ ] Move CMS-only components (`src/components/admin/Editor*Dialog.tsx`, gallery dialogs, etc.) → `src/cms/components/`
- [ ] Move ERP-only components (admit-card builders, marks entry grids, fee receipts, exam scheduling UIs) → `src/erp/components/`
- [ ] Move shared UI (`src/components/ui/`, `src/components/portal/`, `src/components/shared/`) → `src/shared/components/`
- [ ] Move shared libs (Supabase clients, types, utils, validations, permissions) → `src/shared/lib/`
- [ ] Add ESLint boundaries plugin to enforce no cross-module imports
- [ ] DB schema: organize migrations folder by module (`scripts/migrations/base/`, `scripts/migrations/cms/`, `scripts/migrations/erp/`) — file moves only, no schema changes
- [ ] Document which Supabase tables belong to which module in `MODULES.md`

Risks: imports are scattered. ESLint rule will surface ~hundreds of violations initially. Plan for 1–2 days of import-cleanup work.

---

## Phase 3 — Monorepo (productization)

> Goal: three deployable Next.js apps. Each can be built and run independently.

### Repo structure
```
/apps
  /website         <- public marketing site, standalone
    package.json    <- depends on @nkps/shared only
    next.config.js
    src/
  /cms             <- content management Next.js app
    package.json    <- depends on @nkps/shared
    src/
  /erp             <- school operations Next.js app
    package.json    <- depends on @nkps/shared, @nkps/cms-types (for cross-references like TC linkage)
    src/
/packages
  /shared          <- types, supabase clients, UI primitives, auth helpers, permissions catalog
    package.json
    src/
/scripts
  /migrations      <- shared DB migrations, organized by module
turbo.json
pnpm-workspace.yaml
package.json
```

### Deployment topology options
- **Single domain, path-based:** `nkps.com` (website), `nkps.com/cms` (cms via reverse proxy), `nkps.com/erp` (erp via reverse proxy). Most "feels integrated."
- **Subdomains:** `nkps.com` + `cms.nkps.com` + `erp.nkps.com`. Cleaner separation, simpler Vercel deploys.
- **Per-customer:** each school gets only the apps they paid for. Build pipeline takes a `MODULES=cms,erp` flag and builds matching apps.

### Tasks
- [ ] Adopt pnpm + turborepo
- [ ] Move existing single Next.js app → `apps/erp` initially (most code lives here)
- [ ] Extract `apps/website` from public-site routes (`src/app/{about,academics,...}` + components/home)
- [ ] Extract `apps/cms` from cms route group (after Phase 1 + 2 done)
- [ ] Extract `packages/shared`
- [ ] Set up `turbo.json` pipelines: `dev`, `build`, `lint`, `typecheck`
- [ ] Decide deployment topology (Vercel projects per app, or one project per app)
- [ ] CI: per-app build matrix
- [ ] Document module compose modes ("pick which apps to deploy")
- [ ] Update Supabase RLS to handle module-aware deployments (e.g., ERP-only schools don't need CMS tables — drop or skip them)

### Productization considerations
- **DB modularity:** apps share one Supabase project per customer. Tables are namespaced by module. RLS policies don't change. ERP-only or CMS-only customers get a smaller schema (skip migrations from the unused module).
- **Auth:** shared `auth.users` and `profiles` regardless of modules. Even a "website-only" deployment doesn't need auth — but to add CMS later, wire it on day one or stub it.
- **Per-customer config:** `apps/{app}/config/customer.ts` with school name, branding, feature toggles within a module (e.g., disable supplementary exams for schools that don't run them).

### Effort
- Repo restructure + tooling: 3–4 days
- App extractions: 2–3 days each (website is easiest, ERP hardest)
- CI / deploy pipeline: 2 days
- Per-module documentation: 1 day
- **Total: 1–2 weeks** assuming Phases 1 + 2 are clean.

---

## Risk register (cross-phase)

- **Live data:** 29 migrations, real users. Every phase must keep production stable. Commit + verify after every meaningful checkpoint.
- **Auth-tied paths:** middleware, login redirects, Supabase email templates (password reset etc.) reference URLs. Update as paths change.
- **External bookmarks:** keep `/admin/*` 301 redirects through Phase 3 minimum.
- **Editor permissions UI:** `/admin/people/users` will be the place where admins grant CMS or ERP access. After Phase 3, this UI may need to live in a meta-admin app (since it crosses modules). Or keep it in CMS as the lowest-common-denominator app.
