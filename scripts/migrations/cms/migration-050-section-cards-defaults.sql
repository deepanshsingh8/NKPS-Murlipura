-- Migration 050: Make section_cards capable of holding protected default rows.
--
-- Today the website renders each section as: hardcoded defaults baked into
-- React components, with section_cards rows appended after them. Editors can
-- only swap images (via site_media slots) — they cannot edit the title,
-- quote, name, designation, etc. of the cards that ship with the site.
--
-- This migration lays the groundwork to fold those hardcoded defaults into
-- section_cards as protected seed rows, so every card across the site
-- becomes editable / renamable / deactivatable through the CMS.
--
-- Adds:
--   is_default        — true for seeded rows; the CMS hides the delete
--                       action and shows a "Default" badge for them.
--                       Existing user-added rows default to false.
--   default_snapshot  — JSON copy of the seed values, written at insert
--                       time. Powers a "Reset text to default" action that
--                       restores the original copy without re-running this
--                       file. Null for non-default rows.

begin;

alter table section_cards
  add column if not exists is_default boolean not null default false;

alter table section_cards
  add column if not exists default_snapshot jsonb;

-- Helpful index for the "is this the last active card in this section?"
-- check the API runs before allowing a default card to be deactivated.
create index if not exists section_cards_section_active_idx
  on section_cards (section)
  where is_active = true;

commit;
