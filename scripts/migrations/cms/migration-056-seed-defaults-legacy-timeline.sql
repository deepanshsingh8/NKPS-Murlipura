-- Migration 056: Fold legacy_timeline default cards into section_cards.
--
-- Source: apps/website/src/components/about/LegacyTimeline.tsx (`milestones`).
-- No image slots — timeline rows are text only.
--
-- Idempotent.

begin;

insert into section_cards (
  section, year, title, description,
  sort_order, is_active, is_default, default_snapshot
)
select
  'legacy_timeline',
  '1985',
  'Foundation',
  'NK Public School established by Late Shri R.K. Choudhary with just 10 students.',
  0, true, true,
  jsonb_build_object(
    'year', '1985',
    'title', 'Foundation',
    'description', 'NK Public School established by Late Shri R.K. Choudhary with just 10 students.'
  )
where not exists (
  select 1 from section_cards
  where section = 'legacy_timeline' and year = '1985' and title = 'Foundation' and is_default = true
);

insert into section_cards (
  section, year, title, description,
  sort_order, is_active, is_default, default_snapshot
)
select
  'legacy_timeline',
  '1990',
  'CBSE Affiliation',
  'Received affiliation from CBSE, marking a new chapter in academic excellence.',
  1, true, true,
  jsonb_build_object(
    'year', '1990',
    'title', 'CBSE Affiliation',
    'description', 'Received affiliation from CBSE, marking a new chapter in academic excellence.'
  )
where not exists (
  select 1 from section_cards
  where section = 'legacy_timeline' and year = '1990' and title = 'CBSE Affiliation' and is_default = true
);

insert into section_cards (
  section, year, title, description,
  sort_order, is_active, is_default, default_snapshot
)
select
  'legacy_timeline',
  '2000',
  'Campus Expansion',
  'New buildings, laboratories, and sports facilities added to serve growing student body.',
  2, true, true,
  jsonb_build_object(
    'year', '2000',
    'title', 'Campus Expansion',
    'description', 'New buildings, laboratories, and sports facilities added to serve growing student body.'
  )
where not exists (
  select 1 from section_cards
  where section = 'legacy_timeline' and year = '2000' and title = 'Campus Expansion' and is_default = true
);

insert into section_cards (
  section, year, title, description,
  sort_order, is_active, is_default, default_snapshot
)
select
  'legacy_timeline',
  '2010',
  'Digital Era',
  'Smart classrooms and computer labs introduced for technology-integrated learning.',
  3, true, true,
  jsonb_build_object(
    'year', '2010',
    'title', 'Digital Era',
    'description', 'Smart classrooms and computer labs introduced for technology-integrated learning.'
  )
where not exists (
  select 1 from section_cards
  where section = 'legacy_timeline' and year = '2010' and title = 'Digital Era' and is_default = true
);

insert into section_cards (
  section, year, title, description,
  sort_order, is_active, is_default, default_snapshot
)
select
  'legacy_timeline',
  '2024',
  '20000+ Students',
  'Grown into one of Jaipur''s leading institutions with 6 educational institutes.',
  4, true, true,
  jsonb_build_object(
    'year', '2024',
    'title', '20000+ Students',
    'description', 'Grown into one of Jaipur''s leading institutions with 6 educational institutes.'
  )
where not exists (
  select 1 from section_cards
  where section = 'legacy_timeline' and year = '2024' and title = '20000+ Students' and is_default = true
);

commit;
