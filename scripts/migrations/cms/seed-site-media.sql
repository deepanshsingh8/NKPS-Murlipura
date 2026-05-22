-- =============================================================================
-- Pure-SQL equivalent of scripts/migrations/cms/seed-site-media.ts
--
-- Seeds the 5 page-chrome image slots (stats backdrop, founder photo, about
-- hero, facilities hero banner, school logo). Per-card images live in
-- section_cards.image_url after migrations 051–058 — they're not seeded here.
--
-- Behaviour matches the .ts script: INSERT … ON CONFLICT (slot) DO NOTHING.
-- Existing rows are NEVER touched, so any admin-uploaded current_url stays.
-- Idempotent — safe to re-run.
--
-- Use this file when you're working in Supabase Studio. If you have a local
-- shell with .env.local set up, the .ts script is equivalent.
-- =============================================================================

INSERT INTO site_media (slot, page, section, label, current_url, default_url, alt_text, sort_order)
VALUES
  ('stats_background', 'home', 'stats_counter', 'Stats Section Background',
   '/images/gallery/g10.jpg', '/images/gallery/g10.jpg', 'Campus Background', 0),

  ('facilities_hero', 'facilities', 'campus_facilities', 'Facilities — Hero Banner',
   '/images/hero/campus-1.jpg', '/images/hero/campus-1.jpg', 'NK Public School Campus', 0),

  ('founder_photo', 'about', 'founder_tribute', 'Founder Photo',
   '/images/about/rk-choudhary.png', '/images/about/rk-choudhary.png', 'Late Shri R.K. Choudhary', 0),

  ('about_hero', 'about', 'hero', 'About Page Hero Image',
   '/images/gallery/g10.jpg', '/images/gallery/g10.jpg', 'NK Public School Campus', 0),

  ('site_logo', 'global', 'branding', 'School Logo',
   '/images/logo.png', '/images/logo.png', 'NK Public School Logo', 0)
ON CONFLICT (slot) DO NOTHING;
