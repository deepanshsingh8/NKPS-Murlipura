-- Migration 061: News & Achievements sections (home + alumni pages)
-- Adds the CMS-managed section types the homepage "News & Achievements" block
-- and the /alumni page consume:
--   * accolades            — school-level recognition cards (home)
--   * student_achievements — student honours cards (home)
--   * alumni               — alumni-in-the-spotlight cards (/alumni page)
--   * sports_indoor / sports_outdoor — sports cards (student-life), so the CMS
--     Site-Media editor's section list stays in sync with the DB constraint.
--
-- Editable via CMS → Site Media. Defaults below are protected (is_default) and
-- carry ONLY Murlipura-verifiable content sourced from the school's own site
-- (_reference/scraped/murlipura-content.md §8) — no invented figures and no
-- sister-branch (Rajawas) affiliation number.
--
-- TODO(content): the `alumni` section is intentionally left unseeded — the
-- /alumni page renders a graceful "featured here soon" state until the school
-- supplies a real alumni roster with photos (add via CMS).
--
-- Idempotent: the CHECK constraint is discovered + recreated unconditionally;
-- seeds only insert when a section has no rows yet. Images are left null so
-- cards use their built-in icon/gradient fallback (no broken /images links);
-- replace with real photos via the CMS after launch.

begin;

-- 1. Widen the section CHECK constraint. Discover the live constraint name
--    dynamically (inline schema yields section_cards_section_check, but a
--    differently-named live constraint is still replaced) and drop it, then
--    re-add with the full type list. 'latest_updates' is retained so any rows
--    seeded by migration-052 remain valid even though the homepage no longer
--    renders that section.
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
    'hero_slider', 'testimonials', 'latest_updates', 'facilities_preview',
    'leadership', 'legacy_timeline', 'why_choose_us', 'activities',
    'annual_events', 'campus_facilities',
    'accolades', 'student_achievements', 'alumni',
    'sports_indoor', 'sports_outdoor'
  ));

-- 2. Seed default accolade cards (school-level recognition).
insert into section_cards (section, title, description, image_url, sort_order, is_active, is_default, default_snapshot)
select * from (values
  ('accolades', 'Four Decades of Excellence', 'The founding campus of the NKPS group, educating students across Northern Jaipur since 1985 on the founder''s ideals of discipline, knowledge and human values.', null::text, 0, true, true, null::jsonb),
  ('accolades', 'Perfect Board Scores · 2021', 'Multiple students achieved a perfect 100% in the 2021 Secondary and Senior Secondary board examinations.', null::text, 1, true, true, null::jsonb),
  ('accolades', 'National Sports Champions', 'Gold medals won by our students at national-level shooting, grappling and Pencak Silat championships.', null::text, 2, true, true, null::jsonb)
) as v(section, title, description, image_url, sort_order, is_active, is_default, default_snapshot)
where not exists (
  select 1 from section_cards sc where sc.section = 'accolades'
);

-- 3. Seed default student-achievement cards (from the school's published
--    results/awards — see scrape §8). Images null → icon fallback.
insert into section_cards (section, name, title, year, description, image_url, sort_order, is_active, is_default, default_snapshot)
select * from (values
  ('student_achievements', 'Kashvi Sharma', '99.00% · Class XII Commerce', '2025', 'Secured state merit rank 2 in the Class XII board examinations.', null::text, 0, true, true, null::jsonb),
  ('student_achievements', 'Divyanshi Gupta', '98.67% · Class X', '2025', 'Rajasthan state merit rank 8 in the Class X board examinations.', null::text, 1, true, true, null::jsonb),
  ('student_achievements', 'Ansh Mishra', '97.00% · Class XII Science', '2025', 'Among the school''s top scorers in the Class XII Science stream.', null::text, 2, true, true, null::jsonb),
  ('student_achievements', 'Sapna Meena', 'Gold · Pencak Silat', 'National', 'Gold medal at the Pencak Silat Junior National Championship.', null::text, 3, true, true, null::jsonb),
  ('student_achievements', 'Ayushi Meena', 'Gold · Grappling', 'National', 'Gold medal at the National Grappling Championship.', null::text, 4, true, true, null::jsonb),
  ('student_achievements', 'Deependra Singh', 'Gold · Shooting', 'National', 'Gold medal at the National Shooting Championship.', null::text, 5, true, true, null::jsonb)
) as v(section, name, title, year, description, image_url, sort_order, is_active, is_default, default_snapshot)
where not exists (
  select 1 from section_cards sc where sc.section = 'student_achievements'
);

commit;
