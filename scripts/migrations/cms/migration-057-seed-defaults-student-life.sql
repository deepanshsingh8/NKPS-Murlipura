-- Migration 057: Fold activities + annual_events default cards into section_cards.
--
-- Sources:
--   activities    — apps/website/src/app/student-life/StudentLifeContent.tsx
--                   (`defaultActivities`). 6 cards with icon + image.
--   annual_events — same file (`events`). 4 text-only cards (no images).
--
-- Image URLs for activities fold in from student_life_* slots, which are
-- then deleted. annual_events has no slot dependency — text-only seeds.
--
-- Idempotent.

begin;

-- ─── Activities (6 cards) ──────────────────────────────────────────

insert into section_cards (
  section, title, description, icon, image_url,
  sort_order, is_active, is_default, default_snapshot
)
select
  'activities',
  'Music & Dance',
  'Express creativity through classical and contemporary performances',
  'Music',
  coalesce((select current_url from site_media where slot = 'student_life_music_dance'), '/images/gallery/st1.jpg'),
  0, true, true,
  jsonb_build_object(
    'title', 'Music & Dance',
    'description', 'Express creativity through classical and contemporary performances',
    'icon', 'Music',
    'image_url', '/images/gallery/st1.jpg'
  )
where not exists (
  select 1 from section_cards
  where section = 'activities' and title = 'Music & Dance' and is_default = true
);

insert into section_cards (
  section, title, description, icon, image_url,
  sort_order, is_active, is_default, default_snapshot
)
select
  'activities',
  'Art & Craft',
  'Develop artistic skills through painting, sculpture and design',
  'Palette',
  coalesce((select current_url from site_media where slot = 'student_life_art_craft'), '/images/gallery/st2.jpg'),
  1, true, true,
  jsonb_build_object(
    'title', 'Art & Craft',
    'description', 'Develop artistic skills through painting, sculpture and design',
    'icon', 'Palette',
    'image_url', '/images/gallery/st2.jpg'
  )
where not exists (
  select 1 from section_cards
  where section = 'activities' and title = 'Art & Craft' and is_default = true
);

insert into section_cards (
  section, title, description, icon, image_url,
  sort_order, is_active, is_default, default_snapshot
)
select
  'activities',
  'Debate & Elocution',
  'Build confidence and critical thinking through public speaking',
  'MessageSquare',
  coalesce((select current_url from site_media where slot = 'student_life_debate'), '/images/gallery/st3.jpg'),
  2, true, true,
  jsonb_build_object(
    'title', 'Debate & Elocution',
    'description', 'Build confidence and critical thinking through public speaking',
    'icon', 'MessageSquare',
    'image_url', '/images/gallery/st3.jpg'
  )
where not exists (
  select 1 from section_cards
  where section = 'activities' and title = 'Debate & Elocution' and is_default = true
);

insert into section_cards (
  section, title, description, icon, image_url,
  sort_order, is_active, is_default, default_snapshot
)
select
  'activities',
  'Quiz Competitions',
  'Sharpen knowledge and analytical skills in academic quizzes',
  'Brain',
  coalesce((select current_url from site_media where slot = 'student_life_quiz'), '/images/gallery/st4.jpg'),
  3, true, true,
  jsonb_build_object(
    'title', 'Quiz Competitions',
    'description', 'Sharpen knowledge and analytical skills in academic quizzes',
    'icon', 'Brain',
    'image_url', '/images/gallery/st4.jpg'
  )
where not exists (
  select 1 from section_cards
  where section = 'activities' and title = 'Quiz Competitions' and is_default = true
);

insert into section_cards (
  section, title, description, icon, image_url,
  sort_order, is_active, is_default, default_snapshot
)
select
  'activities',
  'Literary Club',
  'Nurture love for reading and creative writing',
  'BookOpen',
  coalesce((select current_url from site_media where slot = 'student_life_literary'), '/images/gallery/st5.jpg'),
  4, true, true,
  jsonb_build_object(
    'title', 'Literary Club',
    'description', 'Nurture love for reading and creative writing',
    'icon', 'BookOpen',
    'image_url', '/images/gallery/st5.jpg'
  )
where not exists (
  select 1 from section_cards
  where section = 'activities' and title = 'Literary Club' and is_default = true
);

insert into section_cards (
  section, title, description, icon, image_url,
  sort_order, is_active, is_default, default_snapshot
)
select
  'activities',
  'Science Club',
  'Hands-on experiments and innovation projects',
  'Cpu',
  coalesce((select current_url from site_media where slot = 'student_life_science'), '/images/gallery/st6.jpg'),
  5, true, true,
  jsonb_build_object(
    'title', 'Science Club',
    'description', 'Hands-on experiments and innovation projects',
    'icon', 'Cpu',
    'image_url', '/images/gallery/st6.jpg'
  )
where not exists (
  select 1 from section_cards
  where section = 'activities' and title = 'Science Club' and is_default = true
);

-- ─── Annual events (4 cards, text only) ────────────────────────────

insert into section_cards (
  section, season, title, description,
  sort_order, is_active, is_default, default_snapshot
)
select
  'annual_events',
  'Winter',
  'Annual Day',
  'A grand celebration of talent, culture and achievement featuring performances by students from all grades',
  0, true, true,
  jsonb_build_object(
    'season', 'Winter',
    'title', 'Annual Day',
    'description', 'A grand celebration of talent, culture and achievement featuring performances by students from all grades'
  )
where not exists (
  select 1 from section_cards
  where section = 'annual_events' and title = 'Annual Day' and is_default = true
);

insert into section_cards (
  section, season, title, description,
  sort_order, is_active, is_default, default_snapshot
)
select
  'annual_events',
  'Monsoon',
  'Sports Day (Chakravyuh)',
  'Inter-house athletic competitions and team sports fostering sportsmanship and physical fitness',
  1, true, true,
  jsonb_build_object(
    'season', 'Monsoon',
    'title', 'Sports Day (Chakravyuh)',
    'description', 'Inter-house athletic competitions and team sports fostering sportsmanship and physical fitness'
  )
where not exists (
  select 1 from section_cards
  where section = 'annual_events' and title = 'Sports Day (Chakravyuh)' and is_default = true
);

insert into section_cards (
  section, season, title, description,
  sort_order, is_active, is_default, default_snapshot
)
select
  'annual_events',
  'Spring',
  'Republic & Independence Day',
  'Patriotic celebrations with cultural programmes, flag hoisting and community participation',
  2, true, true,
  jsonb_build_object(
    'season', 'Spring',
    'title', 'Republic & Independence Day',
    'description', 'Patriotic celebrations with cultural programmes, flag hoisting and community participation'
  )
where not exists (
  select 1 from section_cards
  where section = 'annual_events' and title = 'Republic & Independence Day' and is_default = true
);

insert into section_cards (
  section, season, title, description,
  sort_order, is_active, is_default, default_snapshot
)
select
  'annual_events',
  'Autumn',
  'Science Exhibition',
  'Student-led innovations and project displays showcasing creativity and scientific temper',
  3, true, true,
  jsonb_build_object(
    'season', 'Autumn',
    'title', 'Science Exhibition',
    'description', 'Student-led innovations and project displays showcasing creativity and scientific temper'
  )
where not exists (
  select 1 from section_cards
  where section = 'annual_events' and title = 'Science Exhibition' and is_default = true
);

delete from site_media where slot in (
  'student_life_music_dance', 'student_life_art_craft',
  'student_life_debate', 'student_life_quiz',
  'student_life_literary', 'student_life_science'
);

commit;
