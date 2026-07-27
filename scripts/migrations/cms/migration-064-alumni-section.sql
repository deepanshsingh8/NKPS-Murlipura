-- Migration 064: Alumni section (new /alumni page)
-- Adds a CMS-managed `alumni` section type used by the new Alumni page to
-- showcase special achievements of alumni after they pass out of school —
-- the foundation of a stronger alumni network. Editable via
-- Site Media → Alumni Page → Alumni Achievements (name + batch year +
-- current designation + achievement + optional photo).
--
-- 1. Widen the section_cards CHECK constraint to permit 'alumni' (keeping all
--    previously-allowed values, including 'accolades' from migration 061).
-- 2. Seed a few default alumni cards so the page renders out-of-the-box; admins
--    edit the copy / replace photos via the CMS (defaults are protected from
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
    'campus_facilities', 'accolades', 'alumni'
  ));

-- 2. Seed default alumni achievement cards (placeholder imagery — replace via CMS).
insert into section_cards (section, name, year, designation, description, image_url, sort_order, is_active, is_default, default_snapshot)
select * from (values
  ('alumni', 'Aarav Sharma', 'Class of 2012', 'Software Engineer, Bengaluru', 'Built a career in technology after NKPS — now engineering at a leading global tech company.', '/images/gallery/st1.jpg', 0, true, true, null::jsonb),
  ('alumni', 'Priya Verma', 'Class of 2010', 'Doctor (MBBS, MD)', 'Cleared NEET and went on to serve as a physician, giving back to the community.', '/images/gallery/st2.jpg', 1, true, true, null::jsonb),
  ('alumni', 'Rohan Gupta', 'Class of 2014', 'Civil Services Officer', 'Cracked the UPSC Civil Services Examination and is now serving in public administration.', '/images/gallery/st3.jpg', 2, true, true, null::jsonb)
) as v(section, name, year, designation, description, image_url, sort_order, is_active, is_default, default_snapshot)
where not exists (
  select 1 from section_cards sc where sc.section = 'alumni'
);

commit;
