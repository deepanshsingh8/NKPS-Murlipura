-- Migration 054: Fold facilities_preview default cards into section_cards.
--
-- Source: first 4 entries of FACILITIES in
-- packages/shared/src/lib/constants.ts. The home page has historically
-- shown these four (Smart Classrooms, Science Labs, Computer Lab, Library)
-- as the preview row that links to the full Facilities page.
--
-- Image URLs fold in from facilities_preview_1..4 slots and the slots are
-- deleted. Migration 058 (campus_facilities) reads these section_cards
-- when seeding its first four campus_facilities cards so admin
-- customizations propagate without keeping the duplicate slot rows.
--
-- The icon column stores the Lucide icon name; the React component looks it
-- up via the existing iconMap.
--
-- Idempotent.

begin;

insert into section_cards (
  section, title, description, icon, image_url,
  sort_order, is_active, is_default, default_snapshot
)
select
  'facilities_preview',
  'Smart Classrooms',
  'Technology-enabled classrooms with projectors and digital learning aids for an interactive educational experience.',
  'Monitor',
  coalesce((select current_url from site_media where slot = 'facilities_preview_1'), '/images/news/n1.jpg'),
  0, true, true,
  jsonb_build_object(
    'title', 'Smart Classrooms',
    'description', 'Technology-enabled classrooms with projectors and digital learning aids for an interactive educational experience.',
    'icon', 'Monitor',
    'image_url', '/images/news/n1.jpg'
  )
where not exists (
  select 1 from section_cards
  where section = 'facilities_preview' and title = 'Smart Classrooms' and is_default = true
);

insert into section_cards (
  section, title, description, icon, image_url,
  sort_order, is_active, is_default, default_snapshot
)
select
  'facilities_preview',
  'Science Laboratories',
  'Well-equipped Physics, Chemistry and Biology labs providing hands-on learning opportunities for students.',
  'FlaskConical',
  coalesce((select current_url from site_media where slot = 'facilities_preview_2'), '/images/news/n2.jpg'),
  1, true, true,
  jsonb_build_object(
    'title', 'Science Laboratories',
    'description', 'Well-equipped Physics, Chemistry and Biology labs providing hands-on learning opportunities for students.',
    'icon', 'FlaskConical',
    'image_url', '/images/news/n2.jpg'
  )
where not exists (
  select 1 from section_cards
  where section = 'facilities_preview' and title = 'Science Laboratories' and is_default = true
);

insert into section_cards (
  section, title, description, icon, image_url,
  sort_order, is_active, is_default, default_snapshot
)
select
  'facilities_preview',
  'Computer Lab',
  'Modern computer lab with high-speed internet and latest software for digital literacy and programming skills.',
  'Laptop',
  coalesce((select current_url from site_media where slot = 'facilities_preview_3'), '/images/news/n4.jpg'),
  2, true, true,
  jsonb_build_object(
    'title', 'Computer Lab',
    'description', 'Modern computer lab with high-speed internet and latest software for digital literacy and programming skills.',
    'icon', 'Laptop',
    'image_url', '/images/news/n4.jpg'
  )
where not exists (
  select 1 from section_cards
  where section = 'facilities_preview' and title = 'Computer Lab' and is_default = true
);

insert into section_cards (
  section, title, description, icon, image_url,
  sort_order, is_active, is_default, default_snapshot
)
select
  'facilities_preview',
  'Library',
  'A vast collection of over 10,000 books, periodicals and digital resources fostering a love for reading.',
  'BookOpen',
  coalesce((select current_url from site_media where slot = 'facilities_preview_4'), '/images/news/n6.jpg'),
  3, true, true,
  jsonb_build_object(
    'title', 'Library',
    'description', 'A vast collection of over 10,000 books, periodicals and digital resources fostering a love for reading.',
    'icon', 'BookOpen',
    'image_url', '/images/news/n6.jpg'
  )
where not exists (
  select 1 from section_cards
  where section = 'facilities_preview' and title = 'Library' and is_default = true
);

delete from site_media where slot in (
  'facilities_preview_1', 'facilities_preview_2',
  'facilities_preview_3', 'facilities_preview_4'
);

commit;
