@AGENTS.md

# CLAUDE.md

Guidance for Claude Code (claude.ai/code) working in this repository.

## Project Overview

NK Public School, **Murlipura** — the founding NKPS campus. A **turborepo with
three Next.js apps** sharing one Supabase project: a public website, a CMS, and
a full school ERP (students, staff, exams, fees, timetable, attendance,
transport, plus teacher/student/parent portals).

`apps/erp`, `apps/cms` and `packages/shared` track the parent repo
**deepanshsingh8/NKPS** (the Rajawas campus) and are synced from it
periodically; `apps/website` is Murlipura's own (chalkboard theme) and is not.
See [Murlipura layer](#murlipura-layer--what-a-sync-must-keep) before touching
any of the files listed there.

Next.js 16 (App Router), React 19, TypeScript, Tailwind CSS v4, Framer Motion,
GSAP, Supabase (auth, Postgres, storage). Package manager is **pnpm** — npm will
not resolve the workspace links.

`MODULES.md` is the fuller map (deployment tiers, env vars, Vercel setup).
`_reference/` holds the original Rajawas code and scraped source content.

## Commands

```bash
pnpm install

pnpm run dev            # all three apps via turbo
pnpm run dev:website    # → http://localhost:3001
pnpm run dev:cms        # → http://localhost:3002
pnpm run dev:erp        # → http://localhost:3003

pnpm run build          # all three
pnpm run typecheck
pnpm run lint           # also enforces the module boundary
pnpm run check:guide    # every sidebar link must have a guide entry
pnpm run check:mobile   # form layout rules a browser would catch and tsc can't
pnpm run check:colors   # one colour family per job; no twenty-fourth palette
pnpm run check:pwa      # icon version matches the service worker cache name
```

Run one app with `pnpm --filter @nkps/erp run <script>`. There is **no test
suite**: the commands above plus a browser pass are the regression net.
A full `pnpm run build` needs Supabase env vars — without them the website app
fails at `supabaseUrl is required`, which is environmental, not a code fault.

## Repo layout

```
apps/website/   public marketing site        (www.nkpublicschool.org)
apps/cms/       content management           (cms.nkpublicschool.org)
apps/erp/       school operations            (erp.nkpublicschool.org)
packages/shared/  everything used by ≥2 apps
```

**ESLint enforces the module boundary**: an app may import only from itself and
`@nkps/shared/*`. There is no path between two apps — shared code goes in
`packages/shared` or it does not get shared.

### apps/erp

```
src/app/(admin)/   admin pages with the sidebar — academics, people, exams,
                   fees, timetable, attendance, transport, reports,
                   registrations, calendar
src/app/teacher/   teacher dashboard      src/app/student/   student dashboard
src/app/parent/    parent dashboard       src/app/portal/    portal login flows
src/app/api/       every ERP + portal + staff route
src/lib/           ERP business logic — fees, grading, final-result,
                   report-card, teacher-scope, admin-tables, …
src/proxy.ts       the auth gate (multi-role). NOT middleware.ts.
```

`apps/cms/src/proxy.ts` is the CMS equivalent (admin/editor only).

### packages/shared

`src/lib/supabase/{client,server,admin,middleware}.ts` — browser client, server
component client, service-role client (API routes only), session-refresh helper.

Other load-bearing modules: `permissions.ts` (feature catalog), `verify-admin.ts`,
`admin-proxy.ts`, `admin-api.ts`, `validations.ts` (Zod), `row-dependencies.ts`,
`constants.ts` (`CLASS_ORDER`, `classSortIndex`), `guide/screens.ts`,
`stream-alias.ts`, `teacher-options.ts`, `types/index.ts`.

## Database

Consolidated schema: `supabase-schema.sql`. It is **fresh-install only** and is
not re-runnable — most `CREATE POLICY` statements in it are unguarded.

Historical migrations: `scripts/migrations/{base,cms,erp,cross}/migration-NNN-*.sql`,
**globally numbered**, applied in ascending order. See
`scripts/migrations/README.md`. Every migration must be safe to re-run, and every
change must be mirrored into `supabase-schema.sql`.

`MODULES.md` lists the tables per tier.

### Admin writes go through a proxy

Client code calls `adminApi()` → `POST /api/admin`, gated by
`apps/erp/src/lib/admin-tables.ts`:

- `TABLE_FEATURE_KEY` — which feature key may touch the table.
- `ALLOWED_COLUMNS` — the writable columns. **`allowedTables` is the key set of
  `ALLOWED_COLUMNS`, not of `TABLE_FEATURE_KEY`**, so an entry in the first map
  alone grants nothing. A column missing here is rejected as "Invalid data
  fields", which is a silent-looking bug: add the column when you add it to the
  table.

The proxy is single-table. Anything spanning two tables needs its own route
calling `verifyAdminOrEditor(featureKey)`.

### Editor permissions (per-feature admin access)

Admins have everything; editors get only the features granted to them.

- Catalog: `packages/shared/src/lib/permissions.ts` — keys, labels, URL prefixes,
  admin-only paths. **An admin path with no `PATH_FEATURE_OVERRIDES` mapping is
  open to any editor**, so map every new page.
- Storage: `editor_permissions` `(editor_id, feature_key)`.
- Enforced in three places: the proxy page gate
  (`packages/shared/src/lib/supabase/middleware.ts`), the API gate
  (`verifyAdminOrEditor`), and the sidebar filter.
- Granted on `/administration/users`, which is admin-only forever, along with
  `/registrations` and the exam master screens (`ADMIN_ONLY_PREFIXES`).

### Teacher authorization

Derives from `class_subjects` + `classes.class_teacher_id` via
`get_my_class_ids()` and `lib/teacher-scope.ts` — **not** from the timetable. No
RLS policy reads `timetable_periods`, so a timetable co-teacher gains no
marks-entry or attendance rights.

### Timetable shape

`timetable_periods` is **one row per (class, day, period, group)**, not per cell
(migration 119). `group_no = 0` is the primary group; 1..n are parallel tracks —
Games split into basketball/badminton/cricket, or an XI/XII period running two
optional subjects side by side. A cell has at most one primary group.

`is_shared` exempts a row from the `timetable_teacher_no_overlap` exclusion
constraint, which is how one coach can be on the field for four sections at
once. Everything else still cannot be in two places at one time.

Two diagnostic views: `timetable_teacher_clashes` (every row in it should be a
deliberate shared activity) and `timetable_assignment_drift` (primary groups
only — parallel groups differ from the canonical assignment by design).

## Conventions

- **Guide registry.** `pnpm run check:guide` fails if a sidebar `href` has no
  entry in `packages/shared/src/lib/guide/screens.ts`. Update the entry when a
  screen's controls change, not only when adding a page.
- **Form layout.** `pnpm run check:mobile` enforces four rules that decide
  whether a form works on a phone, none of which `tsc` or ESLint can see:
  no `grid-cols-N` without a breakpoint (use `<FieldRow>`; two controls in
  ~343px of sheet is narrower than a native date input will render), no `vh`
  (iOS resolves it against the viewport *including* the URL bar, so a sheet
  capped at `85vh` hides its own footer), and no raw `<select>`/text `<input>`
  — use `<NativeSelect>`/`<Input>`, which carry the 44px touch target and the
  16px font size below which iOS zooms the page and will not zoom back. A line
  that genuinely needs a fixed column count (a month is seven days wide) opts
  out with a `mobile-layout-ok` comment giving the reason.
- **Dialogs.** `DialogContent` is a bottom sheet below `sm` and a centred card
  above it. Don't pass an unprefixed `max-h-*`/`max-w-*` — it replaces the
  sheet's own cap. A dialog rendered unconditionally and handed an `open` prop
  mounts on every page visit; for a heavy one, pair `next/dynamic` with
  `useMountOnceOpen` so it loads when first opened and still animates closed.
- **Styling.** Tailwind v4, custom theme: navy-900 (primary dark), blue-600
  (accent), gold-500 (secondary accent), cream-50 (backgrounds). **In this
  repo the `navy-*` and `blue-400..600` tokens are forest green** (navy-900 →
  #0A3D2A, blue-600 → #15803D); the names are kept so upstream code applies
  unchanged. Playfair
  Display for headings (`font-heading`), Inter for body (`font-sans`).
- **Palette.** `pnpm run check:colors` holds the app to one colour family per
  job. Brand is navy / gold / cream, structure is gray plus the shadcn tokens,
  and **status is green, amber, red, blue and only those** — a count once found
  twenty-three families, with `emerald` where `green` already meant success and
  `sky` where `blue` already meant information, so the same status came out a
  different colour depending on which screen you were on. Anything else picks
  the right helper rather than a hue: `categoricalChip()`
  (`packages/shared/src/lib/palette.ts`, `cat-1..8`) for things that merely
  differ from each other, `gradeChip()` (`apps/erp/src/lib/grades.ts`,
  `grade-1..7`) for things in an order. The two are separate on purpose —
  a category has no direction, a grade ramp does, and using one for the other
  is how a "C" ends up looking like a warning.

  Module accent hues are real and stay (Timetable cyan, Transport teal,
  Subjects indigo), matching that module's tile on its hub page; the check
  recognises the header-tile shape, so they need no marker. Anything else whose
  hue genuinely carries information — a five-way role badge where collapsing
  two keys would merge two roles — carries `color-ok: <reason>` on the line.
  The reason is required and enforced: a bare marker is still reported, because
  a marker with no reason is drift with a note on it. `apps/website` is out of
  scope; it has no dark mode and reports no statuses.
- **Logo.** The crest's source of truth is `assets/logos/*.svg` (full crest
  and shield-only). Every PNG of it — `public/images/logo.png` in each app,
  favicons, PWA icons, the website OG mark — is generated from those by
  `scripts/generate-pwa-icons.mjs`; never hand-edit a PNG.
- **PWA icons.** Regenerating the icons is not enough to ship them. They keep
  their filenames, so the URLs come out byte-different and string-identical,
  and neither Android's install updater nor any cache in between can tell that
  anything changed. After `node scripts/generate-pwa-icons.mjs`, bump
  `ICON_VERSION` (`packages/shared/src/lib/pwa-manifest.ts`) **and** the `-vN`
  on `CACHE_VERSION` in both `apps/*/public/sw.js`; `pnpm run check:pwa` fails
  if they drift, which is how a new crest once shipped and reached nobody.
  Nothing can check that the PNGs themselves changed — that bump is on you.
  Note that an icon already on a home screen never updates: iOS fetches it once
  at Add-to-Home-Screen time and never looks again, so testing a change means
  removing the app and re-adding it. Don't put a `?v=` on a `next/image` src —
  Next 16 rejects local image query strings unless `images.localPatterns.search`
  matches, so the version belongs on the manifest and `<link>` icons only.
- **shadcn/ui** on base-ui primitives, not Radix. There is no `asChild` — use the
  `render` prop or a controlled `open`/`onOpenChange`.
- **Icons.** Lucide React throughout; brand icons are hand-rolled SVGs in
  `SocialIcons.tsx` because lucide-react dropped them.
- **Animations.** Framer Motion for transitions and scroll reveals; GSAP +
  ScrollTrigger for parallax.
- **Env.** Each app reads its own `.env.local` with `NEXT_PUBLIC_SUPABASE_URL`,
  `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`; symlink all three
  to a root file for local dev.
- **Where does a feature go?** Public display → `website`. Content management →
  `cms`. School operations → `erp`. Used by two or more → `packages/shared`.

## Murlipura layer — what a sync must keep

Sync method (Aug + Sep 2026): a per-file **three-way merge** of `apps/erp`,
`apps/cms` and `packages/shared` with base = the upstream commit last synced,
ours = this repo, theirs = upstream HEAD. Record the upstream SHA in the commit
message and in `tasks/upstream-sync-*.md` — the next sync needs it as its base.

Files that carry Murlipura changes (expect conflicts here, never take theirs):

- Branding: `packages/shared/src/lib/{constants,seo,email}.ts`,
  `pwa-manifest.ts` (`THEME_COLOR`), `components/providers/ThemeProvider.tsx`
  (`THEME_COLORS`), `apps/{erp,cms}/src/app/globals.css` (green ramp + dark
  theme), `components/CounterAnimation.tsx` (`display` prop).
- `scripts/migrations/base/migration-110-school-profile.sql` and its mirror in
  `supabase-schema.sql`: the seed row is Murlipura's, not Rajawas's.
- Murlipura-only features: CMS `holiday-homework/`, `prospectus/`,
  `change-password/`; ERP temporary-password vault (`TempPasswordDialog`,
  `api/users/temp-password`, `lib/temp-credentials.ts`, hooks in
  `administration/users`, `api/users`, `api/users/reset-password`,
  `api/registrations/approve`, `create-portal-user.ts`); **Class Diary**
  (`/class-diary`, `/teacher/class-diary`, `/parent/diary`, `/student/diary`,
  `api/class-diary/*`, `lib/class-diary.ts`, `components/class-diary/*`).
- `permissions.ts` and `types/index.ts` carry keys/types from both sides —
  merge, never overwrite.

Murlipura-local migrations take numbers **from 900 up** (see
`scripts/migrations/README.md`). Each sync ships one
`scripts/migrations/CONSOLIDATED-upstream-sync-YYYY-MM.sql` — that script,
not the individual files, is what has been run against the Murlipura database.
