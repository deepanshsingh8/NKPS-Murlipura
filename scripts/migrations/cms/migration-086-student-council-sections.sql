-- Migration 086: Student Council & House Captains sections (Student Life page)
-- Adds two CMS-managed section types for the annual investiture ceremony:
--
--   student_council — the school-level appointments (Head Boy, Head Girl,
--                     Sports Captain, Cultural Captain, …). Fields used:
--                     name (student), designation (post), role (class &
--                     section), year (session, e.g. 2026-27), message
--                     (optional line from the student), image_url (photo).
--
--   house_captains  — the per-house appointments. Same fields, plus `title`
--                     which carries the HOUSE NAME. The website groups the
--                     cards by `title`, so every captain of a house shares one
--                     panel and the house colour is derived from its name.
--
-- Both render on /student-life directly under the page header, so the current
-- office bearers are the first thing a visiting student sees.
--
-- 1. Widen the section_cards CHECK constraint to permit the two new sections
--    (keeping every previously-allowed value, incl. 'sports_indoor' /
--    'sports_outdoor' from migration 067 and 'student_achievements' from 065).
-- 2. No seed rows. These cards name real, currently-serving students, so
--    placeholder names must never reach the public site — the sections stay
--    hidden on the website until an admin adds cards via
--    Site Media → Student Life Page → Student Council / House Captains.
--    Cards added there are non-default, so admins can freely add AND delete
--    them each time a new council is invested.
-- Idempotent.

begin;

-- 1. Replace any existing CHECK constraint on the `section` column (discovered
--    dynamically) with the full, widened allow-list.
do $$
declare
  c record;
begin
  for c in
    select con.conname
    from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
    where rel.relname = 'section_cards'
      and con.contype = 'c'
      and pg_get_constraintdef(con.oid) ilike '%section%'
  loop
    execute format('alter table section_cards drop constraint %I', c.conname);
  end loop;
end $$;

alter table section_cards add constraint section_cards_section_check
  check (section in (
    'hero_slider', 'testimonials', 'facilities_preview', 'leadership',
    'legacy_timeline', 'why_choose_us', 'activities', 'annual_events',
    'campus_facilities', 'accolades', 'alumni', 'student_achievements',
    'sports_indoor', 'sports_outdoor', 'student_council', 'house_captains'
  ));

commit;
