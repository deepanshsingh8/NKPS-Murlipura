-- Migration 061: Accolades section (home page)
-- Adds a new CMS-managed `accolades` section type for showcasing the school's
-- awards / recognition on the home page, right after "Explore Our Facilities".
-- Editable via Site Media → Home → Accolades (image + title + caption).
--
-- 1. Extend the section_cards CHECK constraint to permit 'accolades'.
-- 2. Seed a few default cards so the section renders out-of-the-box; admins can
--    edit the copy / replace the images via the CMS (defaults are protected
--    from deletion, only deactivatable).
-- Idempotent: constraint is recreated unconditionally; seeds only insert rows
-- that don't already exist (matched by title).

begin;

-- 1. Widen the section CHECK constraint to include 'accolades'. Drop any
--    existing CHECK constraint on the `section` column by its real name (the
--    inline definition in supabase-schema.sql yields section_cards_section_check,
--    but we discover it dynamically so a differently-named live constraint is
--    still replaced rather than left to reject the new value).
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
    'campus_facilities', 'accolades'
  ));

-- 2. Seed default accolade cards (placeholder imagery — replace via CMS).
insert into section_cards (section, title, description, image_url, sort_order, is_active, is_default, default_snapshot)
select * from (values
  ('accolades', 'CBSE Affiliated School', 'Recognised by the Central Board of Secondary Education (Affiliation No. 1730406) for quality education.', '/images/gallery/g1.jpg', 0, true, true, null::jsonb),
  ('accolades', 'Excellence in Academics', 'Consistent record of outstanding board results and academic achievements over four decades.', '/images/gallery/g2.jpg', 1, true, true, null::jsonb),
  ('accolades', 'Sports & Cultural Honours', 'Award-winning performances by our students in district, state and national level competitions.', '/images/gallery/g3.jpg', 2, true, true, null::jsonb)
) as v(section, title, description, image_url, sort_order, is_active, is_default, default_snapshot)
where not exists (
  select 1 from section_cards sc where sc.section = 'accolades'
);

commit;
