# NK Public School, Murlipura

Official website, CMS and ERP for **NK Public School, Murlipura** — the founding NKPS campus in Arya Nagar, Jaipur (established 1985). A Turbo monorepo of three Next.js 16 applications backed by Supabase (Postgres, Auth, Storage).

Cloned from the NKPS Rajawas codebase with a deep-green theme. See `_reference/` for the original Rajawas code, the source-site scrape and archived task logs.

---

## Apps

| App | Path | Dev port | Purpose |
|-----|------|----------|---------|
| Website | `apps/website` | 3001 | Public marketing site |
| CMS | `apps/cms` | 3002 | Content management (gallery, articles, TCs, disclosures, staff) |
| ERP | `apps/erp` | 3003 | Students, exams, fees, timetable, attendance |

The three apps share `packages/shared` — Supabase clients, UI primitives, school constants, SEO helpers, animations and form validation.

---

## Tech stack

| Layer | Technology |
|-------|------------|
| Framework | Next.js 16 (App Router), React 19 |
| Language | TypeScript 5 |
| Monorepo | Turbo + pnpm workspaces |
| Styling | Tailwind CSS v4 — **Forest Emerald + Gold** palette |
| UI | shadcn/ui (Base UI primitives) |
| Motion | Framer Motion, GSAP + ScrollTrigger |
| Backend | Supabase — Auth, Postgres, Storage |
| Email | Resend |
| Forms / validation | React Hook Form + Zod |

---

## Prerequisites

- **Node.js** 20+
- **pnpm** (`packageManager: pnpm@10.33.2`)
- A **Supabase** project (separate from Rajawas)

---

## Getting started

```bash
pnpm install
cp .env.example .env.local   # fill in real values
pnpm dev:website   # localhost:3001
pnpm dev:cms       # localhost:3002
pnpm dev:erp       # localhost:3003
```

To run all three apps together: `pnpm dev` (Turbo).

---

## Supabase setup

1. Create a fresh Supabase project (Mumbai / ap-south-1 region recommended).
2. In the SQL editor, paste **`supabase-schema.sql`** and run. The file defines 67 tables, indexes, RLS policies, triggers and functions — and is **structure only**, with no seed data.
3. Create storage buckets:

   | Bucket | Visibility |
   |--------|------------|
   | `gallery` | public read |
   | `transfer-certificates` | private (signed URLs) |
   | `site-media` | public read |
   | `staff-photos` | public read |
   | `disclosure-documents` | public read |
   | `avatars` | public read |

4. Copy the project URL, anon key and service-role key into `.env.local`.
5. Create the first admin user (Auth → Users → Add user), then in SQL editor:
   ```sql
   UPDATE profiles SET role = 'admin' WHERE email = 'your@email.com';
   ```

---

## Environment variables

See `.env.example` for the complete list. Required for the apps to boot:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`

Optional but recommended for full functionality:

- `ANTHROPIC_API_KEY` — enables the home-page chatbot
- `RESEND_API_KEY` + `FROM_EMAIL` — enables welcome / password-reset emails
- `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` — Contact page map
- `NEXT_PUBLIC_GA_ID`, `NEXT_PUBLIC_GSC_VERIFICATION`

The service-role key bypasses RLS — keep it server-only.

---

## Theme

The Tailwind token names from the Rajawas codebase are kept for backward compatibility (`navy-*`, `blue-*`, `gold-*`, `cream-*`) — only the underlying values changed:

| Token | Was (Rajawas) | Now (Murlipura) |
|-------|---------------|-----------------|
| `navy-900` | `#0A1628` navy | `#0A3D2A` deep forest |
| `navy-800` | `#111D35` | `#14532D` |
| `navy-700` | `#1A2744` | `#1A5F35` |
| `blue-600` | `#2563EB` indigo | `#15803D` rich emerald |
| `blue-500` | `#3B82F6` | `#16A34A` |
| `gold-500` | `#D4A843` | `#D4A843` (unchanged) |
| `cream-50` | `#FDFBF7` | `#FDFBF7` (unchanged) |

Source-of-truth: `apps/{website,cms,erp}/src/app/globals.css`.

---

## School constants

`packages/shared/src/lib/constants.ts` holds the school identity used across all three apps (name, address, phones, emails, leadership, stats). Update there to change site-wide branding.

`STAFF` arrays are intentionally empty — populate via the CMS staff directory once you're ready.

---

## Routes

**Public website:**
`/`, `/about`, `/academics`, `/admissions`, `/student-life`, `/facilities`, `/gallery`, `/articles`, `/contact`, `/transfer-certificates`, `/mandatory-public-disclosure`, `/academic-calendar`, `/for-parents`

**CMS (`apps/cms`):**
Gallery, Articles, Transfer certificates, Contact inbox, Disclosures, Site media, Section cards, Staff directory, Users / editor permissions.

**ERP (`apps/erp`):**
Admin dashboard (people, exams, fees, timetable, attendance, results, transport) plus separate portal sub-apps for `/teacher`, `/student` and `/parent`.

**Generated:** `/sitemap.xml`, `/robots.txt`, `/opengraph-image`.

---

## License

Private (`"private": true` in `package.json`).
