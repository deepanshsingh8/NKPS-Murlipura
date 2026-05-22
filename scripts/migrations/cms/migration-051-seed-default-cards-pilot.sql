-- Migration 051: Seed default section_cards for the pilot (testimonials + leadership).
--
-- Folds two sections of hardcoded React content into section_cards as protected
-- defaults so editors can edit/rename/deactivate them through the CMS:
--
--   1. Testimonials — copied verbatim from
--      apps/website/src/components/home/Testimonials.tsx (the `testimonials`
--      const that the component used to render unconditionally before the
--      DB-backed cards were appended).
--
--   2. Leadership — copied from packages/shared/src/lib/constants.ts
--      (SCHOOL.leadership). Each row's image_url is folded in from whatever
--      the corresponding leadership_* site_media slot holds today, so any
--      photo an admin already uploaded carries over. The default_snapshot
--      captures the *original* seed image (the slot's default_url) so
--      "Reset text to default" doesn't have to remember the photo path.
--
-- After this migration:
--   - The 3 leadership_* slots are removed from site_media (they're now
--     redundant — each card's image lives in section_cards.image_url).
--   - Components rendering testimonials and leadership are still backed by
--     the same shape; the matching component edits land in the next step.
--
-- Idempotent: every INSERT is gated on NOT EXISTS for that section + the
-- canonical primary text, so re-running won't double-seed.

begin;

-- ─────────────────────────────────────────────────────────────────
-- Testimonials (3 default cards)
-- ─────────────────────────────────────────────────────────────────

insert into section_cards (
  section, quote, name, role, initials,
  sort_order, is_active, is_default, default_snapshot
)
select
  'testimonials',
  'NK Public School has provided my child with an excellent foundation in academics and extracurricular activities. The teachers are dedicated and the facilities are top-notch.',
  'Mrs. Sharma',
  'Parent of Class VIII student',
  'S',
  0, true, true,
  jsonb_build_object(
    'quote', 'NK Public School has provided my child with an excellent foundation in academics and extracurricular activities. The teachers are dedicated and the facilities are top-notch.',
    'name', 'Mrs. Sharma',
    'role', 'Parent of Class VIII student',
    'initials', 'S'
  )
where not exists (
  select 1 from section_cards
  where section = 'testimonials' and name = 'Mrs. Sharma' and is_default = true
);

insert into section_cards (
  section, quote, name, role, initials,
  sort_order, is_active, is_default, default_snapshot
)
select
  'testimonials',
  'The school''s focus on discipline and holistic development has truly shaped my son''s character. We are grateful for the nurturing environment.',
  'Mr. Patel',
  'Parent of Class X student',
  'P',
  1, true, true,
  jsonb_build_object(
    'quote', 'The school''s focus on discipline and holistic development has truly shaped my son''s character. We are grateful for the nurturing environment.',
    'name', 'Mr. Patel',
    'role', 'Parent of Class X student',
    'initials', 'P'
  )
where not exists (
  select 1 from section_cards
  where section = 'testimonials' and name = 'Mr. Patel' and is_default = true
);

insert into section_cards (
  section, quote, name, role, initials,
  sort_order, is_active, is_default, default_snapshot
)
select
  'testimonials',
  'From sports to arts, the school ensures every child discovers their talent. The COVID-19 response was also commendable — classes never stopped.',
  'Mrs. Gupta',
  'Parent of Class V student',
  'G',
  2, true, true,
  jsonb_build_object(
    'quote', 'From sports to arts, the school ensures every child discovers their talent. The COVID-19 response was also commendable — classes never stopped.',
    'name', 'Mrs. Gupta',
    'role', 'Parent of Class V student',
    'initials', 'G'
  )
where not exists (
  select 1 from section_cards
  where section = 'testimonials' and name = 'Mrs. Gupta' and is_default = true
);

-- ─────────────────────────────────────────────────────────────────
-- Leadership (3 default cards). image_url is folded in from the
-- existing leadership_* site_media slot so admin customizations carry over.
-- ─────────────────────────────────────────────────────────────────

insert into section_cards (
  section, name, designation, message, image_url,
  sort_order, is_active, is_default, default_snapshot
)
select
  'leadership',
  'Dr. N.C. Lunayach',
  'Managing Director',
  'Education is the foundation of a brighter future. We strive to provide an environment where every child discovers their potential and grows into responsible citizens.',
  coalesce(
    (select current_url from site_media where slot = 'leadership_managing_director'),
    '/images/staff/managing-director.jpg'
  ),
  0, true, true,
  jsonb_build_object(
    'name', 'Dr. N.C. Lunayach',
    'designation', 'Managing Director',
    'message', 'Education is the foundation of a brighter future. We strive to provide an environment where every child discovers their potential and grows into responsible citizens.',
    'image_url', '/images/staff/managing-director.jpg'
  )
where not exists (
  select 1 from section_cards
  where section = 'leadership' and name = 'Dr. N.C. Lunayach' and is_default = true
);

insert into section_cards (
  section, name, designation, message, image_url,
  sort_order, is_active, is_default, default_snapshot
)
select
  'leadership',
  'Mr. Kuldeep Singh',
  'Director',
  'Our institution stands on the pillars of discipline, knowledge and progressive growth. We are committed to creating a world-class educational experience for all students.',
  coalesce(
    (select current_url from site_media where slot = 'leadership_director'),
    '/images/staff/director.jpg'
  ),
  1, true, true,
  jsonb_build_object(
    'name', 'Mr. Kuldeep Singh',
    'designation', 'Director',
    'message', 'Our institution stands on the pillars of discipline, knowledge and progressive growth. We are committed to creating a world-class educational experience for all students.',
    'image_url', '/images/staff/director.jpg'
  )
where not exists (
  select 1 from section_cards
  where section = 'leadership' and name = 'Mr. Kuldeep Singh' and is_default = true
);

insert into section_cards (
  section, name, designation, message, image_url,
  sort_order, is_active, is_default, default_snapshot
)
select
  'leadership',
  'Mrs. Prema Kavia',
  'Principal',
  'At NK Public School, we believe every child is unique. Our dedicated faculty ensures holistic development through academic excellence and co-curricular activities.',
  coalesce(
    (select current_url from site_media where slot = 'leadership_principal'),
    '/images/staff/principal.jpg'
  ),
  2, true, true,
  jsonb_build_object(
    'name', 'Mrs. Prema Kavia',
    'designation', 'Principal',
    'message', 'At NK Public School, we believe every child is unique. Our dedicated faculty ensures holistic development through academic excellence and co-curricular activities.',
    'image_url', '/images/staff/principal.jpg'
  )
where not exists (
  select 1 from section_cards
  where section = 'leadership' and name = 'Mrs. Prema Kavia' and is_default = true
);

-- ─────────────────────────────────────────────────────────────────
-- Drop the now-redundant leadership_* slots. The cards table is the
-- single source of truth for leadership card images going forward.
-- ─────────────────────────────────────────────────────────────────

delete from site_media where slot in (
  'leadership_managing_director',
  'leadership_director',
  'leadership_principal'
);

commit;
