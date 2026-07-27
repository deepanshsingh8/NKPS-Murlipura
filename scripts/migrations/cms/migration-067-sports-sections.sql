-- Migration 067: Sports & Athletics sections (Student Life page)
-- Adds two CMS-managed section types — `sports_indoor` and `sports_outdoor` —
-- rendered together as the "Sports & Athletics" block on the Student Life page,
-- split into Indoor and Outdoor games. Each card is a single game: a name
-- (stored in `title`) plus an image (uploaded via Site Media → Student Life).
-- On the public site the images are clickable and expand in a lightbox.
--
-- 1. Widen the section_cards CHECK constraint to permit the two new sections
--    (keeping all previously-allowed values, incl. 'student_achievements' from
--    migration 065, 'alumni' from 064 and 'accolades' from 061).
-- 2. Seed the starter game lists the school provided. Seeded as NON-default
--    rows (is_default = false) so admins can fully add AND remove games via the
--    CMS — defaults are otherwise only deactivatable, but full curation control
--    is the explicit requirement here.
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
    'sports_indoor', 'sports_outdoor'
  ));

-- 2. Seed the starter games (image_url left null — admins upload images via the
--    CMS; the public site shows a tasteful placeholder until then).
insert into section_cards (section, title, sort_order, is_active, is_default)
select * from (values
  ('sports_indoor',  'Karate',         0, true, false),
  ('sports_indoor',  'Chess',          1, true, false),
  ('sports_indoor',  'Yoga',           2, true, false),
  ('sports_indoor',  'Carrom',         3, true, false),
  ('sports_indoor',  'Table Tennis',   4, true, false),
  ('sports_indoor',  'Badminton',      5, true, false),
  ('sports_outdoor', 'Football',       0, true, false),
  ('sports_outdoor', 'Basketball',     1, true, false),
  ('sports_outdoor', 'Athletics',      2, true, false),
  ('sports_outdoor', 'Volleyball',     3, true, false),
  ('sports_outdoor', 'Kabaddi',        4, true, false),
  ('sports_outdoor', 'Kho Kho',        5, true, false),
  ('sports_outdoor', 'Roller Skating', 6, true, false)
) as v(section, title, sort_order, is_active, is_default)
where not exists (
  select 1 from section_cards sc
  where sc.section = v.section
);

commit;
