-- Migration 053: Fold hero_slider default cards into section_cards.
--
-- Source: apps/website/src/components/home/HeroSlider.tsx (`defaultSlides`).
-- These are the three full-screen rotating slides on the homepage. Title
-- preserves the embedded newline (rendered as a line break in the heading).
--
-- Image URLs fold in from hero_slide_1/2/3; those slots are deleted.
--
-- Idempotent.

begin;

insert into section_cards (
  section, title, subtitle, cta_text, cta_link, image_url,
  sort_order, is_active, is_default, default_snapshot
)
select
  'hero_slider',
  E'Best CBSE School\nin Jaipur',
  'Empowering young minds with holistic education since 1985',
  'Explore Admissions',
  '/admissions',
  coalesce((select current_url from site_media where slot = 'hero_slide_1'), '/images/hero/campus-1.jpg'),
  0, true, true,
  jsonb_build_object(
    'title', E'Best CBSE School\nin Jaipur',
    'subtitle', 'Empowering young minds with holistic education since 1985',
    'cta_text', 'Explore Admissions',
    'cta_link', '/admissions',
    'image_url', '/images/hero/campus-1.jpg'
  )
where not exists (
  select 1 from section_cards
  where section = 'hero_slider' and title = E'Best CBSE School\nin Jaipur' and is_default = true
);

insert into section_cards (
  section, title, subtitle, cta_text, cta_link, image_url,
  sort_order, is_active, is_default, default_snapshot
)
select
  'hero_slider',
  E'Excellence in\nCBSE Education',
  'CBSE affiliated institution nurturing 20,000+ students across Jaipur',
  'Learn More',
  '/about',
  coalesce((select current_url from site_media where slot = 'hero_slide_2'), '/images/hero/campus-2.avif'),
  1, true, true,
  jsonb_build_object(
    'title', E'Excellence in\nCBSE Education',
    'subtitle', 'CBSE affiliated institution nurturing 20,000+ students across Jaipur',
    'cta_text', 'Learn More',
    'cta_link', '/about',
    'image_url', '/images/hero/campus-2.avif'
  )
where not exists (
  select 1 from section_cards
  where section = 'hero_slider' and title = E'Excellence in\nCBSE Education' and is_default = true
);

insert into section_cards (
  section, title, subtitle, cta_text, cta_link, image_url,
  sort_order, is_active, is_default, default_snapshot
)
select
  'hero_slider',
  E'Leaders Are\nMade Here',
  'Building character through discipline, education and human values',
  'Discover More',
  '/academics',
  coalesce((select current_url from site_media where slot = 'hero_slide_3'), '/images/news/n5.jpg'),
  2, true, true,
  jsonb_build_object(
    'title', E'Leaders Are\nMade Here',
    'subtitle', 'Building character through discipline, education and human values',
    'cta_text', 'Discover More',
    'cta_link', '/academics',
    'image_url', '/images/news/n5.jpg'
  )
where not exists (
  select 1 from section_cards
  where section = 'hero_slider' and title = E'Leaders Are\nMade Here' and is_default = true
);

delete from site_media where slot in (
  'hero_slide_1', 'hero_slide_2', 'hero_slide_3'
);

commit;
