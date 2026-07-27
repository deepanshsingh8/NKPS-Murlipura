-- Migration 059: Remove the latest_updates section_cards section entirely.
--
-- The home page "Latest Updates" section is now driven solely by published
-- articles (CMS Articles area). The section_cards-based fallback and its CMS
-- "Site Media" management were redundant — the school keeps at least one
-- published article (e.g. an evergreen "History of NKPS"), so the home section
-- is never empty. This reverses migration 052.
--
-- Steps:
--   1. Delete all section_cards rows where section = 'latest_updates'
--      (both the seeded defaults and any admin-added cards).
--   2. Tighten the section CHECK constraint to drop 'latest_updates'.
--
-- Idempotent.

begin;

-- 1. Drop all latest_updates cards.
delete from section_cards where section = 'latest_updates';

-- 2. Recreate the section CHECK constraint without 'latest_updates'.
--    (Inline CHECK constraints get the auto-generated name
--    section_cards_section_check.)
alter table section_cards
  drop constraint if exists section_cards_section_check;

alter table section_cards
  add constraint section_cards_section_check
  check (section in (
    'hero_slider', 'testimonials', 'facilities_preview', 'leadership',
    'legacy_timeline', 'why_choose_us', 'activities', 'annual_events',
    'campus_facilities'
  ));

commit;
