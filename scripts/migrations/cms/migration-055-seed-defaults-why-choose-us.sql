-- Migration 055: Fold why_choose_us default cards into section_cards.
--
-- Source: apps/website/src/components/about/WhyChooseUs.tsx (`features`).
-- No image slots to migrate — these cards are icon-only on the website.
-- The icon column stores the Lucide icon name; the component looks it up
-- via the existing iconMap.
--
-- Idempotent.

begin;

insert into section_cards (
  section, title, description, icon,
  sort_order, is_active, is_default, default_snapshot
)
select
  'why_choose_us',
  'Experienced Faculty',
  'Our faculty brings years of experience in delivering quality education across all subjects.',
  'Award',
  0, true, true,
  jsonb_build_object(
    'title', 'Experienced Faculty',
    'description', 'Our faculty brings years of experience in delivering quality education across all subjects.',
    'icon', 'Award'
  )
where not exists (
  select 1 from section_cards
  where section = 'why_choose_us' and title = 'Experienced Faculty' and is_default = true
);

insert into section_cards (
  section, title, description, icon,
  sort_order, is_active, is_default, default_snapshot
)
select
  'why_choose_us',
  'Holistic Curriculum',
  'Balanced approach combining academics with sports, arts, and character development.',
  'BookOpen',
  1, true, true,
  jsonb_build_object(
    'title', 'Holistic Curriculum',
    'description', 'Balanced approach combining academics with sports, arts, and character development.',
    'icon', 'BookOpen'
  )
where not exists (
  select 1 from section_cards
  where section = 'why_choose_us' and title = 'Holistic Curriculum' and is_default = true
);

insert into section_cards (
  section, title, description, icon,
  sort_order, is_active, is_default, default_snapshot
)
select
  'why_choose_us',
  'Smart Classrooms',
  'Equipped with modern teaching technologies for interactive and engaging learning.',
  'Monitor',
  2, true, true,
  jsonb_build_object(
    'title', 'Smart Classrooms',
    'description', 'Equipped with modern teaching technologies for interactive and engaging learning.',
    'icon', 'Monitor'
  )
where not exists (
  select 1 from section_cards
  where section = 'why_choose_us' and title = 'Smart Classrooms' and is_default = true
);

insert into section_cards (
  section, title, description, icon,
  sort_order, is_active, is_default, default_snapshot
)
select
  'why_choose_us',
  '100% Board Results',
  'We are proud of our consistent academic performance in CBSE board examinations.',
  'Trophy',
  3, true, true,
  jsonb_build_object(
    'title', '100% Board Results',
    'description', 'We are proud of our consistent academic performance in CBSE board examinations.',
    'icon', 'Trophy'
  )
where not exists (
  select 1 from section_cards
  where section = 'why_choose_us' and title = '100% Board Results' and is_default = true
);

commit;
