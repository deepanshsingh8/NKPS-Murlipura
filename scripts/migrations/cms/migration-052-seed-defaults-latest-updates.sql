-- Migration 052: Fold latest_updates default cards into section_cards.
--
-- Source: apps/website/src/components/home/LatestUpdates.tsx (`defaultUpdates`).
-- The component renders these unconditionally as a fallback when no published
-- articles exist. After this migration the same fallbacks live in
-- section_cards as protected default rows, fully editable through the CMS.
--
-- Image URLs are folded in from the latest_update_1/2/3 slots so any admin
-- customizations carry over. Slots are then deleted — image_url becomes the
-- single source of truth for these card images.
--
-- Idempotent.

begin;

insert into section_cards (
  section, date, title, description, image_url,
  sort_order, is_active, is_default, default_snapshot
)
select
  'latest_updates',
  'March 2026',
  'Admissions Open 2026-27',
  'Applications are now being accepted for all classes. Secure your child''s future with quality education at NKPS.',
  coalesce((select current_url from site_media where slot = 'latest_update_1'), '/images/news/n2.jpg'),
  0, true, true,
  jsonb_build_object(
    'date', 'March 2026',
    'title', 'Admissions Open 2026-27',
    'description', 'Applications are now being accepted for all classes. Secure your child''s future with quality education at NKPS.',
    'image_url', '/images/news/n2.jpg'
  )
where not exists (
  select 1 from section_cards
  where section = 'latest_updates' and title = 'Admissions Open 2026-27' and is_default = true
);

insert into section_cards (
  section, date, title, description, image_url,
  sort_order, is_active, is_default, default_snapshot
)
select
  'latest_updates',
  'February 2026',
  'Annual Sports Meet',
  'Chakravyuh 2025-26 — celebrating athletic excellence and sportsmanship across all age groups.',
  coalesce((select current_url from site_media where slot = 'latest_update_2'), '/images/news/n4.jpg'),
  1, true, true,
  jsonb_build_object(
    'date', 'February 2026',
    'title', 'Annual Sports Meet',
    'description', 'Chakravyuh 2025-26 — celebrating athletic excellence and sportsmanship across all age groups.',
    'image_url', '/images/news/n4.jpg'
  )
where not exists (
  select 1 from section_cards
  where section = 'latest_updates' and title = 'Annual Sports Meet' and is_default = true
);

insert into section_cards (
  section, date, title, description, image_url,
  sort_order, is_active, is_default, default_snapshot
)
select
  'latest_updates',
  'January 2026',
  'Board Exam Preparation',
  'Special coaching sessions for Class X and XII students with expert guidance and practice tests.',
  coalesce((select current_url from site_media where slot = 'latest_update_3'), '/images/news/n6.jpg'),
  2, true, true,
  jsonb_build_object(
    'date', 'January 2026',
    'title', 'Board Exam Preparation',
    'description', 'Special coaching sessions for Class X and XII students with expert guidance and practice tests.',
    'image_url', '/images/news/n6.jpg'
  )
where not exists (
  select 1 from section_cards
  where section = 'latest_updates' and title = 'Board Exam Preparation' and is_default = true
);

delete from site_media where slot in (
  'latest_update_1', 'latest_update_2', 'latest_update_3'
);

commit;
