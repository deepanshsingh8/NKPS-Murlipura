-- Migration 058: Fold campus_facilities default cards into section_cards.
--
-- Source: all 8 entries of FACILITIES in
-- packages/shared/src/lib/constants.ts. The dedicated /facilities page lists
-- the same Smart Classrooms / Science Labs / Computer Lab / Library cards as
-- the homepage preview, plus four campus-only entries (Sports, Auditorium,
-- Indoor Games, Transport).
--
-- For the first four, we read the image_url from the section_cards rows
-- migration 054 inserted (since the original facilities_preview_* slots have
-- already been deleted at that point). If 054 hasn't run yet we fall back to
-- the original site_media slot, then the static default — so the migration
-- is order-tolerant even for partial deployments.
--
-- For the last four, image URLs fold in from facilities_sports / _auditorium
-- / _indoor_games / _transport slots and those slots are deleted.
-- facilities_hero stays — it's the page banner, not a card.
--
-- Idempotent.

begin;

-- First 4: shared with home preview. Prefer the section_cards image (set by
-- migration 054), then the original slot, then the static default.

insert into section_cards (
  section, title, description, icon, image_url,
  sort_order, is_active, is_default, default_snapshot
)
select
  'campus_facilities',
  'Smart Classrooms',
  'Technology-enabled classrooms with projectors and digital learning aids for an interactive educational experience.',
  'Monitor',
  coalesce(
    (select image_url from section_cards where section = 'facilities_preview' and title = 'Smart Classrooms' and is_default = true),
    (select current_url from site_media where slot = 'facilities_preview_1'),
    '/images/news/n1.jpg'
  ),
  0, true, true,
  jsonb_build_object(
    'title', 'Smart Classrooms',
    'description', 'Technology-enabled classrooms with projectors and digital learning aids for an interactive educational experience.',
    'icon', 'Monitor',
    'image_url', '/images/news/n1.jpg'
  )
where not exists (
  select 1 from section_cards
  where section = 'campus_facilities' and title = 'Smart Classrooms' and is_default = true
);

insert into section_cards (
  section, title, description, icon, image_url,
  sort_order, is_active, is_default, default_snapshot
)
select
  'campus_facilities',
  'Science Laboratories',
  'Well-equipped Physics, Chemistry and Biology labs providing hands-on learning opportunities for students.',
  'FlaskConical',
  coalesce(
    (select image_url from section_cards where section = 'facilities_preview' and title = 'Science Laboratories' and is_default = true),
    (select current_url from site_media where slot = 'facilities_preview_2'),
    '/images/news/n2.jpg'
  ),
  1, true, true,
  jsonb_build_object(
    'title', 'Science Laboratories',
    'description', 'Well-equipped Physics, Chemistry and Biology labs providing hands-on learning opportunities for students.',
    'icon', 'FlaskConical',
    'image_url', '/images/news/n2.jpg'
  )
where not exists (
  select 1 from section_cards
  where section = 'campus_facilities' and title = 'Science Laboratories' and is_default = true
);

insert into section_cards (
  section, title, description, icon, image_url,
  sort_order, is_active, is_default, default_snapshot
)
select
  'campus_facilities',
  'Computer Lab',
  'Modern computer lab with high-speed internet and latest software for digital literacy and programming skills.',
  'Laptop',
  coalesce(
    (select image_url from section_cards where section = 'facilities_preview' and title = 'Computer Lab' and is_default = true),
    (select current_url from site_media where slot = 'facilities_preview_3'),
    '/images/news/n4.jpg'
  ),
  2, true, true,
  jsonb_build_object(
    'title', 'Computer Lab',
    'description', 'Modern computer lab with high-speed internet and latest software for digital literacy and programming skills.',
    'icon', 'Laptop',
    'image_url', '/images/news/n4.jpg'
  )
where not exists (
  select 1 from section_cards
  where section = 'campus_facilities' and title = 'Computer Lab' and is_default = true
);

insert into section_cards (
  section, title, description, icon, image_url,
  sort_order, is_active, is_default, default_snapshot
)
select
  'campus_facilities',
  'Library',
  'A vast collection of over 10,000 books, periodicals and digital resources fostering a love for reading.',
  'BookOpen',
  coalesce(
    (select image_url from section_cards where section = 'facilities_preview' and title = 'Library' and is_default = true),
    (select current_url from site_media where slot = 'facilities_preview_4'),
    '/images/news/n6.jpg'
  ),
  3, true, true,
  jsonb_build_object(
    'title', 'Library',
    'description', 'A vast collection of over 10,000 books, periodicals and digital resources fostering a love for reading.',
    'icon', 'BookOpen',
    'image_url', '/images/news/n6.jpg'
  )
where not exists (
  select 1 from section_cards
  where section = 'campus_facilities' and title = 'Library' and is_default = true
);

-- Last 4: campus-page-only.

insert into section_cards (
  section, title, description, icon, image_url,
  sort_order, is_active, is_default, default_snapshot
)
select
  'campus_facilities',
  'Sports Grounds',
  'Expansive playgrounds with facilities for cricket, football, basketball, athletics and more.',
  'Trophy',
  coalesce((select current_url from site_media where slot = 'facilities_sports'), '/images/news/n7.jpg'),
  4, true, true,
  jsonb_build_object(
    'title', 'Sports Grounds',
    'description', 'Expansive playgrounds with facilities for cricket, football, basketball, athletics and more.',
    'icon', 'Trophy',
    'image_url', '/images/news/n7.jpg'
  )
where not exists (
  select 1 from section_cards
  where section = 'campus_facilities' and title = 'Sports Grounds' and is_default = true
);

insert into section_cards (
  section, title, description, icon, image_url,
  sort_order, is_active, is_default, default_snapshot
)
select
  'campus_facilities',
  'Auditorium',
  'State-of-the-art auditorium for cultural events, annual functions and academic seminars.',
  'Theater',
  coalesce((select current_url from site_media where slot = 'facilities_auditorium'), '/images/news/n3.jpg'),
  5, true, true,
  jsonb_build_object(
    'title', 'Auditorium',
    'description', 'State-of-the-art auditorium for cultural events, annual functions and academic seminars.',
    'icon', 'Theater',
    'image_url', '/images/news/n3.jpg'
  )
where not exists (
  select 1 from section_cards
  where section = 'campus_facilities' and title = 'Auditorium' and is_default = true
);

insert into section_cards (
  section, title, description, icon, image_url,
  sort_order, is_active, is_default, default_snapshot
)
select
  'campus_facilities',
  'Indoor Games',
  'Dedicated spaces for table tennis, chess, carrom and other indoor recreational activities.',
  'Gamepad2',
  coalesce((select current_url from site_media where slot = 'facilities_indoor_games'), '/images/news/n5.jpg'),
  6, true, true,
  jsonb_build_object(
    'title', 'Indoor Games',
    'description', 'Dedicated spaces for table tennis, chess, carrom and other indoor recreational activities.',
    'icon', 'Gamepad2',
    'image_url', '/images/news/n5.jpg'
  )
where not exists (
  select 1 from section_cards
  where section = 'campus_facilities' and title = 'Indoor Games' and is_default = true
);

insert into section_cards (
  section, title, description, icon, image_url,
  sort_order, is_active, is_default, default_snapshot
)
select
  'campus_facilities',
  'Transport',
  'Safe and reliable school bus transport covering major routes across Jaipur city.',
  'Bus',
  coalesce((select current_url from site_media where slot = 'facilities_transport'), '/images/gallery/g10.jpg'),
  7, true, true,
  jsonb_build_object(
    'title', 'Transport',
    'description', 'Safe and reliable school bus transport covering major routes across Jaipur city.',
    'icon', 'Bus',
    'image_url', '/images/gallery/g10.jpg'
  )
where not exists (
  select 1 from section_cards
  where section = 'campus_facilities' and title = 'Transport' and is_default = true
);

delete from site_media where slot in (
  'facilities_sports', 'facilities_auditorium',
  'facilities_indoor_games', 'facilities_transport'
);

commit;
