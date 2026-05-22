# Migrations

SQL migrations and seed scripts grouped by the module they belong to. The folder
mirrors the productization tiers documented in [`MODULES.md`](../../MODULES.md):
a CMS-only customer never runs `erp/`, an ERP-only customer never runs `cms/`,
and so on.

For fresh installs prefer `supabase-schema.sql` at the repo root — it's the
consolidated, current-state mirror of every migration here. These files exist
for two reasons: historical record, and to upgrade an environment that's
already past some prior migration.

## Layout

```
scripts/migrations/
├── base/    — required by every deployment (profiles, editor_permissions, calendar)
├── cms/     — content tables (gallery, articles, transfer certificates, staff_members, …)
├── erp/     — ERP tables (students, exams, fees, timetable, attendance, …)
└── cross/   — touch tables in more than one module
```

Numeric prefixes are global across folders — they are the chronological order
in which the migrations were originally written and applied to production.
Two-digit prefix collisions (`027-*`, `031-*`, `044-*`) are intentional; both
files in each pair were applied independently and are kept under their original
names. See `migration-043-db-hygiene-2.sql` for the reasoning on why we did not
renumber them.

## Apply order

Within a single tier, apply files in ascending numeric order. When mixing
tiers, interleave by number across folders — the global timeline is what
matters, not the folder partition.

| Tier | Folders to apply (in numeric order) |
|---|---|
| Website-only | `base/` |
| Website + CMS | `base/` + `cms/` |
| Website + CMS + ERP | `base/` + `cms/` + `erp/` + `cross/` |

The two `cross/` migrations only run on a full ERP+CMS deployment:

- `migration-013-tc-generate-and-transport.sql` — links CMS `transfer_certificates` to ERP `students` and adds transport opt-in to `student_enrollments`. Requires both modules.
- `migration-045-updated-at-triggers-sweep.sql` — sweeps `updated_at` triggers across CMS and ERP tables. Each table is gated on existence, so the file is safe to re-run on partial installs, but it is grouped here because its intent spans both modules.

## Seeds

Seed data lives under the module that owns the table:

- `cms/seed-staff.sql` — initial `staff_members` rows
- `cms/seed-site-media.ts` — default `site_media` slot URLs (idempotent upsert)
- `cms/migrate-static-gallery.ts` — uploads the 12 bundled static gallery images

Run with `npx tsx scripts/migrations/cms/<file>.ts` (or paste the SQL into
Supabase Studio). The TS scripts read `.env.local` from the repo root.

## Helper scripts

Files at `scripts/` root (prefixed `_`) are inspection and diagnostic helpers
— not migrations. They survey live DB state, verify constraints, or apply a
specific migration via the service role. They are intentionally not grouped
into a module folder because they're dev-only utilities.
