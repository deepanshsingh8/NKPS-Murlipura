@AGENTS.md

# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

NK Public School, Murlipura — the founding NKPS campus website, CMS and ERP, cloned from the Rajawas codebase with a deep-green theme and Murlipura-specific branding. Built with Next.js 16 (App Router), TypeScript, Tailwind CSS v4, Framer Motion, GSAP, and Supabase (auth, database, file storage).

Reference material for the migration (original Rajawas code, scraped source content, archived task logs) lives under `_reference/`.

## Commands

- **Dev server:** `npm run dev`
- **Build:** `npm run build`
- **Lint:** `npm run lint`
- **Start production:** `npm start`

## Architecture

### Framework: Next.js 15 App Router
- `src/app/` — file-based routing with layouts
- `src/app/api/` — API routes (contact form handler)
- `middleware.ts` — Supabase auth guard for `/admin` routes

### Pages (14 routes)
- **Public:** `/`, `/about`, `/academics`, `/admissions`, `/student-life`, `/facilities`, `/gallery`, `/contact`, `/transfer-certificates`
- **Admin:** `/admin` (dashboard), `/admin/login`, `/admin/gallery` (CRUD), `/admin/transfer-certificates` (CRUD)
- **Generated:** `/sitemap.xml`, `/robots.txt`

### Component Organization
- `src/components/layout/` — Navbar, Footer, TopBar, PageHeader, ScrollToTop
- `src/components/home/` — HeroSlider, QuickLinks, FacilitiesPreview, StatsCounter, LatestUpdates, Testimonials
- `src/components/about/` — LegacyTimeline, FounderTribute, LeadershipGrid, WhyChooseUs, AchievementsCounter
- `src/components/academics/` — CurriculumOverview, StaffDirectory
- `src/components/admin/` — AdminSidebar
- `src/components/shared/` — AnimatedSection, SectionHeading, CounterAnimation, GlassCard, SocialIcons
- `src/components/ui/` — shadcn/ui auto-generated components

### Backend: Supabase
- `src/lib/supabase/client.ts` — browser client
- `src/lib/supabase/server.ts` — server component client
- `src/lib/supabase/admin.ts` — service role client (API routes only)
- `src/lib/supabase/middleware.ts` — auth session refresh helper
- Database tables: `gallery_images`, `transfer_certificates`, `contact_submissions`
- Storage buckets: `gallery` (images), `transfer-certificates` (PDFs)
- Schema in `supabase-schema.sql`

### Editor permissions (per-feature admin access)
- Admins have full access. Editors only see/modify features explicitly granted.
- Feature catalog: `src/lib/permissions.ts` (single source of truth for keys, labels, URL prefixes, admin-only paths).
- Storage: `editor_permissions` table, `(editor_id, feature_key)`. Migration: `scripts/migrations/base/migration-009-editor-permissions.sql`.
- Enforcement: middleware (page gate, `src/lib/supabase/middleware.ts`), `verifyAdminOrEditor(featureKey)` (API gate, `src/lib/verify-admin.ts`), dynamic sidebar filter (`AdminSidebar.tsx`).
- Admin manages per-editor grants on `/admin/users` via the "Permissions" button (`EditorPermissionsDialog.tsx` → `/api/admin/editor-permissions`).
- `/admin/users` is admin-only forever (see `ADMIN_ONLY_PREFIXES`).

### Key Files
- `src/lib/constants.ts` — all school data (contact, staff, facilities, leadership)
- `src/lib/animations.ts` — Framer Motion animation variants
- `src/lib/validations.ts` — Zod schemas for forms
- `src/types/index.ts` — TypeScript interfaces for DB models

## Key Conventions

- **Styling:** Tailwind CSS v4 with custom theme. **Forest Emerald + Gold** palette. Token names are kept (`navy-*`, `blue-*`) for backward compatibility with the Rajawas codebase, but the underlying values are deep forest green (navy-900 → #0A3D2A, blue-600 → #15803D). Gold-500 (#D4A843) and cream-50 (#FDFBF7) accents are unchanged. Fonts: Playfair Display (headings via `font-heading`), Inter (body via `font-sans`).
- **Animations:** Framer Motion for component transitions and scroll reveals. GSAP+ScrollTrigger for advanced parallax effects.
- **Icons:** Lucide React for all standard icons. Custom SVG components in `SocialIcons.tsx` for brand icons (Facebook, Instagram, YouTube) since lucide-react no longer includes brand icons.
- **Admin auth:** Supabase email/password. Middleware redirects unauthenticated users from `/admin/*` to `/admin/login`.
- **shadcn/ui:** Uses base-ui primitives (not Radix). No `asChild` prop — use `render` prop or controlled `open`/`onOpenChange` pattern instead.
- **Environment:** `.env.local` with `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`.
