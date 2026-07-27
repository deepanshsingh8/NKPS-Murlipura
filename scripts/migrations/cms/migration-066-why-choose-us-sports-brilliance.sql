-- Migration 066: "Why Choose Us" — rename board-results card + add Sports Brilliance
-- About page → Why Choose Us section (section_cards, section = 'why_choose_us').
--
-- 1. Rename the default "100% Board Results" card to "Exceptional Board Results"
--    (also updates its default_snapshot so Reset-to-Default stays consistent).
--    Only touches the still-default card; an admin-renamed card is left alone.
-- 2. Add a 5th default card "Sports Brilliance" (Medal icon, sort_order 4).
-- Idempotent: the rename matches the old title (a no-op once applied); the
-- insert is guarded by a not-exists check on the new title.

begin;

-- 1. Rename board-results card.
update section_cards
set title = 'Exceptional Board Results',
    default_snapshot = jsonb_set(
      coalesce(default_snapshot, '{}'::jsonb),
      '{title}', '"Exceptional Board Results"'
    )
where section = 'why_choose_us'
  and title = '100% Board Results';

-- 2. Add the Sports Brilliance card.
insert into section_cards (
  section, title, description, icon,
  sort_order, is_active, is_default, default_snapshot
)
select
  'why_choose_us',
  'Sports Brilliance',
  'Our students excel on the field, winning laurels at district, state and national level competitions.',
  'Medal',
  4, true, true,
  jsonb_build_object(
    'title', 'Sports Brilliance',
    'description', 'Our students excel on the field, winning laurels at district, state and national level competitions.',
    'icon', 'Medal'
  )
where not exists (
  select 1 from section_cards
  where section = 'why_choose_us' and title = 'Sports Brilliance' and is_default = true
);

commit;
