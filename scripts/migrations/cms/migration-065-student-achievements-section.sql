-- Migration 065: Student Achievements section (home page)
-- Adds a CMS-managed `student_achievements` section type, shown as the middle
-- column of the new "News & Achievements" block on the home page (alongside
-- Latest Updates / articles and School Accolades). Editable via
-- Site Media → Home → Student Achievements (student name + achievement title +
-- description + optional year + optional photo).
--
-- 1. Widen the section_cards CHECK constraint to permit 'student_achievements'
--    (keeping all previously-allowed values, including 'accolades' from
--    migration 061 and 'alumni' from migration 064).
-- 2. Seed a few default cards so the column renders out-of-the-box; admins edit
--    the copy / replace photos via the CMS (defaults are protected from
--    deletion, only deactivatable).
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
    'campus_facilities', 'accolades', 'alumni', 'student_achievements'
  ));

-- 2. Seed default student achievement cards (placeholder imagery — replace via CMS).
insert into section_cards (section, name, title, year, description, image_url, sort_order, is_active, is_default, default_snapshot)
select * from (values
  ('student_achievements', 'Ananya Singh', 'District Topper — Class X', '2024', 'Scored 98.6% in the CBSE Class X board exams, ranking first in the district.', '/images/gallery/st1.jpg', 0, true, true, null::jsonb),
  ('student_achievements', 'Kabir Mehta', 'State-Level Chess Champion', '2024', 'Won gold at the Rajasthan State Chess Championship, representing the school with distinction.', '/images/gallery/st2.jpg', 1, true, true, null::jsonb),
  ('student_achievements', 'Diya Agarwal', 'National Science Olympiad Rank', '2023', 'Secured an All-India rank in the National Science Olympiad, among the top performers nationwide.', '/images/gallery/st3.jpg', 2, true, true, null::jsonb)
) as v(section, name, title, year, description, image_url, sort_order, is_active, is_default, default_snapshot)
where not exists (
  select 1 from section_cards sc where sc.section = 'student_achievements'
);

commit;
