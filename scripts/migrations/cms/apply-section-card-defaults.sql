-- =============================================================================
-- One-shot bundle: section_cards defaults (migrations 050–058)
--
-- This file is the concatenation of every migration that turns the hardcoded
-- "default" component data into protected section_cards rows, plus the schema
-- change that backs them. Paste it whole into Supabase Studio's SQL editor
-- (or psql) on an existing environment to apply the entire flexible-defaults
-- feature in a single run.
--
-- Each phase below is wrapped in its own begin/commit — if one step fails,
-- earlier phases stay applied and you only have to re-run from the failing
-- phase down. Every INSERT is idempotent (`WHERE NOT EXISTS`) so re-running
-- the whole file is safe.
--
-- Order matters: 050 must run before any of the 051–058 seeds (they depend
-- on the new is_default / default_snapshot columns).
--
-- For fresh installs, use supabase-schema.sql at the repo root instead — it
-- already includes all of this in its consolidated form.
-- =============================================================================


-- ─────────────────────────────────────────────────────────────────────────────
-- 050: schema change — add is_default + default_snapshot to section_cards
-- ─────────────────────────────────────────────────────────────────────────────

begin;

alter table section_cards
  add column if not exists is_default boolean not null default false;

alter table section_cards
  add column if not exists default_snapshot jsonb;

create index if not exists section_cards_section_active_idx
  on section_cards (section)
  where is_active = true;

commit;


-- ─────────────────────────────────────────────────────────────────────────────
-- 051: pilot — testimonials + leadership defaults
-- Fold the 3 testimonials and 3 leadership rows into section_cards.
-- Drop the now-redundant leadership_* image slots.
-- ─────────────────────────────────────────────────────────────────────────────

begin;

insert into section_cards (
  section, quote, name, role, initials,
  sort_order, is_active, is_default, default_snapshot
)
select
  'testimonials',
  'NK Public School has provided my child with an excellent foundation in academics and extracurricular activities. The teachers are dedicated and the facilities are top-notch.',
  'Mrs. Sharma', 'Parent of Class VIII student', 'S',
  0, true, true,
  jsonb_build_object(
    'quote', 'NK Public School has provided my child with an excellent foundation in academics and extracurricular activities. The teachers are dedicated and the facilities are top-notch.',
    'name', 'Mrs. Sharma', 'role', 'Parent of Class VIII student', 'initials', 'S'
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
  'Mr. Patel', 'Parent of Class X student', 'P',
  1, true, true,
  jsonb_build_object(
    'quote', 'The school''s focus on discipline and holistic development has truly shaped my son''s character. We are grateful for the nurturing environment.',
    'name', 'Mr. Patel', 'role', 'Parent of Class X student', 'initials', 'P'
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
  'Mrs. Gupta', 'Parent of Class V student', 'G',
  2, true, true,
  jsonb_build_object(
    'quote', 'From sports to arts, the school ensures every child discovers their talent. The COVID-19 response was also commendable — classes never stopped.',
    'name', 'Mrs. Gupta', 'role', 'Parent of Class V student', 'initials', 'G'
  )
where not exists (
  select 1 from section_cards
  where section = 'testimonials' and name = 'Mrs. Gupta' and is_default = true
);

insert into section_cards (
  section, name, designation, message, image_url,
  sort_order, is_active, is_default, default_snapshot
)
select
  'leadership',
  'Dr. N.C. Lunayach', 'Managing Director',
  'Education is the foundation of a brighter future. We strive to provide an environment where every child discovers their potential and grows into responsible citizens.',
  coalesce(
    (select current_url from site_media where slot = 'leadership_managing_director'),
    '/images/staff/managing-director.jpg'
  ),
  0, true, true,
  jsonb_build_object(
    'name', 'Dr. N.C. Lunayach', 'designation', 'Managing Director',
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
  'Mr. Kuldeep Singh', 'Director',
  'Our institution stands on the pillars of discipline, knowledge and progressive growth. We are committed to creating a world-class educational experience for all students.',
  coalesce(
    (select current_url from site_media where slot = 'leadership_director'),
    '/images/staff/director.jpg'
  ),
  1, true, true,
  jsonb_build_object(
    'name', 'Mr. Kuldeep Singh', 'designation', 'Director',
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
  'Mrs. Prema Kavia', 'Principal',
  'At NK Public School, we believe every child is unique. Our dedicated faculty ensures holistic development through academic excellence and co-curricular activities.',
  coalesce(
    (select current_url from site_media where slot = 'leadership_principal'),
    '/images/staff/principal.jpg'
  ),
  2, true, true,
  jsonb_build_object(
    'name', 'Mrs. Prema Kavia', 'designation', 'Principal',
    'message', 'At NK Public School, we believe every child is unique. Our dedicated faculty ensures holistic development through academic excellence and co-curricular activities.',
    'image_url', '/images/staff/principal.jpg'
  )
where not exists (
  select 1 from section_cards
  where section = 'leadership' and name = 'Mrs. Prema Kavia' and is_default = true
);

delete from site_media where slot in (
  'leadership_managing_director', 'leadership_director', 'leadership_principal'
);

commit;


-- ─────────────────────────────────────────────────────────────────────────────
-- 052: latest_updates defaults
-- ─────────────────────────────────────────────────────────────────────────────

begin;

insert into section_cards (
  section, date, title, description, image_url,
  sort_order, is_active, is_default, default_snapshot
)
select
  'latest_updates', 'March 2026', 'Admissions Open 2026-27',
  'Applications are now being accepted for all classes. Secure your child''s future with quality education at NKPS.',
  coalesce((select current_url from site_media where slot = 'latest_update_1'), '/images/news/n2.jpg'),
  0, true, true,
  jsonb_build_object(
    'date', 'March 2026', 'title', 'Admissions Open 2026-27',
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
  'latest_updates', 'February 2026', 'Annual Sports Meet',
  'Chakravyuh 2025-26 — celebrating athletic excellence and sportsmanship across all age groups.',
  coalesce((select current_url from site_media where slot = 'latest_update_2'), '/images/news/n4.jpg'),
  1, true, true,
  jsonb_build_object(
    'date', 'February 2026', 'title', 'Annual Sports Meet',
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
  'latest_updates', 'January 2026', 'Board Exam Preparation',
  'Special coaching sessions for Class X and XII students with expert guidance and practice tests.',
  coalesce((select current_url from site_media where slot = 'latest_update_3'), '/images/news/n6.jpg'),
  2, true, true,
  jsonb_build_object(
    'date', 'January 2026', 'title', 'Board Exam Preparation',
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


-- ─────────────────────────────────────────────────────────────────────────────
-- 053: hero_slider defaults (titles preserve embedded newline)
-- ─────────────────────────────────────────────────────────────────────────────

begin;

insert into section_cards (
  section, title, subtitle, cta_text, cta_link, image_url,
  sort_order, is_active, is_default, default_snapshot
)
select
  'hero_slider', E'Best CBSE School\nin Jaipur',
  'Empowering young minds with holistic education since 1985',
  'Explore Admissions', '/admissions',
  coalesce((select current_url from site_media where slot = 'hero_slide_1'), '/images/hero/campus-1.jpg'),
  0, true, true,
  jsonb_build_object(
    'title', E'Best CBSE School\nin Jaipur',
    'subtitle', 'Empowering young minds with holistic education since 1985',
    'cta_text', 'Explore Admissions', 'cta_link', '/admissions',
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
  'hero_slider', E'Excellence in\nCBSE Education',
  'CBSE affiliated institution nurturing 20,000+ students across Jaipur',
  'Learn More', '/about',
  coalesce((select current_url from site_media where slot = 'hero_slide_2'), '/images/hero/campus-2.avif'),
  1, true, true,
  jsonb_build_object(
    'title', E'Excellence in\nCBSE Education',
    'subtitle', 'CBSE affiliated institution nurturing 20,000+ students across Jaipur',
    'cta_text', 'Learn More', 'cta_link', '/about',
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
  'hero_slider', E'Leaders Are\nMade Here',
  'Building character through discipline, education and human values',
  'Discover More', '/academics',
  coalesce((select current_url from site_media where slot = 'hero_slide_3'), '/images/news/n5.jpg'),
  2, true, true,
  jsonb_build_object(
    'title', E'Leaders Are\nMade Here',
    'subtitle', 'Building character through discipline, education and human values',
    'cta_text', 'Discover More', 'cta_link', '/academics',
    'image_url', '/images/news/n5.jpg'
  )
where not exists (
  select 1 from section_cards
  where section = 'hero_slider' and title = E'Leaders Are\nMade Here' and is_default = true
);

delete from site_media where slot in ('hero_slide_1', 'hero_slide_2', 'hero_slide_3');

commit;


-- ─────────────────────────────────────────────────────────────────────────────
-- 054: facilities_preview defaults (first 4 facilities)
-- ─────────────────────────────────────────────────────────────────────────────

begin;

insert into section_cards (
  section, title, description, icon, image_url,
  sort_order, is_active, is_default, default_snapshot
)
select
  'facilities_preview', 'Smart Classrooms',
  'Technology-enabled classrooms with projectors and digital learning aids for an interactive educational experience.',
  'Monitor',
  coalesce((select current_url from site_media where slot = 'facilities_preview_1'), '/images/news/n1.jpg'),
  0, true, true,
  jsonb_build_object(
    'title', 'Smart Classrooms',
    'description', 'Technology-enabled classrooms with projectors and digital learning aids for an interactive educational experience.',
    'icon', 'Monitor', 'image_url', '/images/news/n1.jpg'
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
  'facilities_preview', 'Science Laboratories',
  'Well-equipped Physics, Chemistry and Biology labs providing hands-on learning opportunities for students.',
  'FlaskConical',
  coalesce((select current_url from site_media where slot = 'facilities_preview_2'), '/images/news/n2.jpg'),
  1, true, true,
  jsonb_build_object(
    'title', 'Science Laboratories',
    'description', 'Well-equipped Physics, Chemistry and Biology labs providing hands-on learning opportunities for students.',
    'icon', 'FlaskConical', 'image_url', '/images/news/n2.jpg'
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
  'facilities_preview', 'Computer Lab',
  'Modern computer lab with high-speed internet and latest software for digital literacy and programming skills.',
  'Laptop',
  coalesce((select current_url from site_media where slot = 'facilities_preview_3'), '/images/news/n4.jpg'),
  2, true, true,
  jsonb_build_object(
    'title', 'Computer Lab',
    'description', 'Modern computer lab with high-speed internet and latest software for digital literacy and programming skills.',
    'icon', 'Laptop', 'image_url', '/images/news/n4.jpg'
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
  'facilities_preview', 'Library',
  'A vast collection of over 10,000 books, periodicals and digital resources fostering a love for reading.',
  'BookOpen',
  coalesce((select current_url from site_media where slot = 'facilities_preview_4'), '/images/news/n6.jpg'),
  3, true, true,
  jsonb_build_object(
    'title', 'Library',
    'description', 'A vast collection of over 10,000 books, periodicals and digital resources fostering a love for reading.',
    'icon', 'BookOpen', 'image_url', '/images/news/n6.jpg'
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


-- ─────────────────────────────────────────────────────────────────────────────
-- 055: why_choose_us defaults (no image slots)
-- ─────────────────────────────────────────────────────────────────────────────

begin;

insert into section_cards (section, title, description, icon, sort_order, is_active, is_default, default_snapshot)
select 'why_choose_us', 'Experienced Faculty',
  'Our faculty brings years of experience in delivering quality education across all subjects.',
  'Award', 0, true, true,
  jsonb_build_object('title','Experienced Faculty',
    'description','Our faculty brings years of experience in delivering quality education across all subjects.',
    'icon','Award')
where not exists (select 1 from section_cards where section='why_choose_us' and title='Experienced Faculty' and is_default=true);

insert into section_cards (section, title, description, icon, sort_order, is_active, is_default, default_snapshot)
select 'why_choose_us', 'Holistic Curriculum',
  'Balanced approach combining academics with sports, arts, and character development.',
  'BookOpen', 1, true, true,
  jsonb_build_object('title','Holistic Curriculum',
    'description','Balanced approach combining academics with sports, arts, and character development.',
    'icon','BookOpen')
where not exists (select 1 from section_cards where section='why_choose_us' and title='Holistic Curriculum' and is_default=true);

insert into section_cards (section, title, description, icon, sort_order, is_active, is_default, default_snapshot)
select 'why_choose_us', 'Smart Classrooms',
  'Equipped with modern teaching technologies for interactive and engaging learning.',
  'Monitor', 2, true, true,
  jsonb_build_object('title','Smart Classrooms',
    'description','Equipped with modern teaching technologies for interactive and engaging learning.',
    'icon','Monitor')
where not exists (select 1 from section_cards where section='why_choose_us' and title='Smart Classrooms' and is_default=true);

insert into section_cards (section, title, description, icon, sort_order, is_active, is_default, default_snapshot)
select 'why_choose_us', '100% Board Results',
  'We are proud of our consistent academic performance in CBSE board examinations.',
  'Trophy', 3, true, true,
  jsonb_build_object('title','100% Board Results',
    'description','We are proud of our consistent academic performance in CBSE board examinations.',
    'icon','Trophy')
where not exists (select 1 from section_cards where section='why_choose_us' and title='100% Board Results' and is_default=true);

commit;


-- ─────────────────────────────────────────────────────────────────────────────
-- 056: legacy_timeline defaults (no image slots)
-- ─────────────────────────────────────────────────────────────────────────────

begin;

insert into section_cards (section, year, title, description, sort_order, is_active, is_default, default_snapshot)
select 'legacy_timeline', '1985', 'Foundation',
  'NK Public School established by Late Shri R.K. Choudhary with just 10 students.',
  0, true, true,
  jsonb_build_object('year','1985','title','Foundation',
    'description','NK Public School established by Late Shri R.K. Choudhary with just 10 students.')
where not exists (select 1 from section_cards where section='legacy_timeline' and year='1985' and title='Foundation' and is_default=true);

insert into section_cards (section, year, title, description, sort_order, is_active, is_default, default_snapshot)
select 'legacy_timeline', '1990', 'CBSE Affiliation',
  'Received affiliation from CBSE, marking a new chapter in academic excellence.',
  1, true, true,
  jsonb_build_object('year','1990','title','CBSE Affiliation',
    'description','Received affiliation from CBSE, marking a new chapter in academic excellence.')
where not exists (select 1 from section_cards where section='legacy_timeline' and year='1990' and title='CBSE Affiliation' and is_default=true);

insert into section_cards (section, year, title, description, sort_order, is_active, is_default, default_snapshot)
select 'legacy_timeline', '2000', 'Campus Expansion',
  'New buildings, laboratories, and sports facilities added to serve growing student body.',
  2, true, true,
  jsonb_build_object('year','2000','title','Campus Expansion',
    'description','New buildings, laboratories, and sports facilities added to serve growing student body.')
where not exists (select 1 from section_cards where section='legacy_timeline' and year='2000' and title='Campus Expansion' and is_default=true);

insert into section_cards (section, year, title, description, sort_order, is_active, is_default, default_snapshot)
select 'legacy_timeline', '2010', 'Digital Era',
  'Smart classrooms and computer labs introduced for technology-integrated learning.',
  3, true, true,
  jsonb_build_object('year','2010','title','Digital Era',
    'description','Smart classrooms and computer labs introduced for technology-integrated learning.')
where not exists (select 1 from section_cards where section='legacy_timeline' and year='2010' and title='Digital Era' and is_default=true);

insert into section_cards (section, year, title, description, sort_order, is_active, is_default, default_snapshot)
select 'legacy_timeline', '2024', '20000+ Students',
  'Grown into one of Jaipur''s leading institutions with 6 educational institutes.',
  4, true, true,
  jsonb_build_object('year','2024','title','20000+ Students',
    'description','Grown into one of Jaipur''s leading institutions with 6 educational institutes.')
where not exists (select 1 from section_cards where section='legacy_timeline' and year='2024' and title='20000+ Students' and is_default=true);

commit;


-- ─────────────────────────────────────────────────────────────────────────────
-- 057: activities (6) + annual_events (4) defaults
-- ─────────────────────────────────────────────────────────────────────────────

begin;

insert into section_cards (section, title, description, icon, image_url, sort_order, is_active, is_default, default_snapshot)
select 'activities', 'Music & Dance',
  'Express creativity through classical and contemporary performances',
  'Music', coalesce((select current_url from site_media where slot='student_life_music_dance'), '/images/gallery/st1.jpg'),
  0, true, true,
  jsonb_build_object('title','Music & Dance',
    'description','Express creativity through classical and contemporary performances',
    'icon','Music','image_url','/images/gallery/st1.jpg')
where not exists (select 1 from section_cards where section='activities' and title='Music & Dance' and is_default=true);

insert into section_cards (section, title, description, icon, image_url, sort_order, is_active, is_default, default_snapshot)
select 'activities', 'Art & Craft',
  'Develop artistic skills through painting, sculpture and design',
  'Palette', coalesce((select current_url from site_media where slot='student_life_art_craft'), '/images/gallery/st2.jpg'),
  1, true, true,
  jsonb_build_object('title','Art & Craft',
    'description','Develop artistic skills through painting, sculpture and design',
    'icon','Palette','image_url','/images/gallery/st2.jpg')
where not exists (select 1 from section_cards where section='activities' and title='Art & Craft' and is_default=true);

insert into section_cards (section, title, description, icon, image_url, sort_order, is_active, is_default, default_snapshot)
select 'activities', 'Debate & Elocution',
  'Build confidence and critical thinking through public speaking',
  'MessageSquare', coalesce((select current_url from site_media where slot='student_life_debate'), '/images/gallery/st3.jpg'),
  2, true, true,
  jsonb_build_object('title','Debate & Elocution',
    'description','Build confidence and critical thinking through public speaking',
    'icon','MessageSquare','image_url','/images/gallery/st3.jpg')
where not exists (select 1 from section_cards where section='activities' and title='Debate & Elocution' and is_default=true);

insert into section_cards (section, title, description, icon, image_url, sort_order, is_active, is_default, default_snapshot)
select 'activities', 'Quiz Competitions',
  'Sharpen knowledge and analytical skills in academic quizzes',
  'Brain', coalesce((select current_url from site_media where slot='student_life_quiz'), '/images/gallery/st4.jpg'),
  3, true, true,
  jsonb_build_object('title','Quiz Competitions',
    'description','Sharpen knowledge and analytical skills in academic quizzes',
    'icon','Brain','image_url','/images/gallery/st4.jpg')
where not exists (select 1 from section_cards where section='activities' and title='Quiz Competitions' and is_default=true);

insert into section_cards (section, title, description, icon, image_url, sort_order, is_active, is_default, default_snapshot)
select 'activities', 'Literary Club',
  'Nurture love for reading and creative writing',
  'BookOpen', coalesce((select current_url from site_media where slot='student_life_literary'), '/images/gallery/st5.jpg'),
  4, true, true,
  jsonb_build_object('title','Literary Club',
    'description','Nurture love for reading and creative writing',
    'icon','BookOpen','image_url','/images/gallery/st5.jpg')
where not exists (select 1 from section_cards where section='activities' and title='Literary Club' and is_default=true);

insert into section_cards (section, title, description, icon, image_url, sort_order, is_active, is_default, default_snapshot)
select 'activities', 'Science Club',
  'Hands-on experiments and innovation projects',
  'Cpu', coalesce((select current_url from site_media where slot='student_life_science'), '/images/gallery/st6.jpg'),
  5, true, true,
  jsonb_build_object('title','Science Club',
    'description','Hands-on experiments and innovation projects',
    'icon','Cpu','image_url','/images/gallery/st6.jpg')
where not exists (select 1 from section_cards where section='activities' and title='Science Club' and is_default=true);

insert into section_cards (section, season, title, description, sort_order, is_active, is_default, default_snapshot)
select 'annual_events', 'Winter', 'Annual Day',
  'A grand celebration of talent, culture and achievement featuring performances by students from all grades',
  0, true, true,
  jsonb_build_object('season','Winter','title','Annual Day',
    'description','A grand celebration of talent, culture and achievement featuring performances by students from all grades')
where not exists (select 1 from section_cards where section='annual_events' and title='Annual Day' and is_default=true);

insert into section_cards (section, season, title, description, sort_order, is_active, is_default, default_snapshot)
select 'annual_events', 'Monsoon', 'Sports Day (Chakravyuh)',
  'Inter-house athletic competitions and team sports fostering sportsmanship and physical fitness',
  1, true, true,
  jsonb_build_object('season','Monsoon','title','Sports Day (Chakravyuh)',
    'description','Inter-house athletic competitions and team sports fostering sportsmanship and physical fitness')
where not exists (select 1 from section_cards where section='annual_events' and title='Sports Day (Chakravyuh)' and is_default=true);

insert into section_cards (section, season, title, description, sort_order, is_active, is_default, default_snapshot)
select 'annual_events', 'Spring', 'Republic & Independence Day',
  'Patriotic celebrations with cultural programmes, flag hoisting and community participation',
  2, true, true,
  jsonb_build_object('season','Spring','title','Republic & Independence Day',
    'description','Patriotic celebrations with cultural programmes, flag hoisting and community participation')
where not exists (select 1 from section_cards where section='annual_events' and title='Republic & Independence Day' and is_default=true);

insert into section_cards (section, season, title, description, sort_order, is_active, is_default, default_snapshot)
select 'annual_events', 'Autumn', 'Science Exhibition',
  'Student-led innovations and project displays showcasing creativity and scientific temper',
  3, true, true,
  jsonb_build_object('season','Autumn','title','Science Exhibition',
    'description','Student-led innovations and project displays showcasing creativity and scientific temper')
where not exists (select 1 from section_cards where section='annual_events' and title='Science Exhibition' and is_default=true);

delete from site_media where slot in (
  'student_life_music_dance', 'student_life_art_craft',
  'student_life_debate', 'student_life_quiz',
  'student_life_literary', 'student_life_science'
);

commit;


-- ─────────────────────────────────────────────────────────────────────────────
-- 058: campus_facilities defaults (8 cards). First 4 reuse the
-- facilities_preview cards 054 just inserted, then fall back to the original
-- slot, then the static default — order-tolerant.
-- ─────────────────────────────────────────────────────────────────────────────

begin;

insert into section_cards (section, title, description, icon, image_url, sort_order, is_active, is_default, default_snapshot)
select 'campus_facilities', 'Smart Classrooms',
  'Technology-enabled classrooms with projectors and digital learning aids for an interactive educational experience.',
  'Monitor',
  coalesce(
    (select image_url from section_cards where section='facilities_preview' and title='Smart Classrooms' and is_default=true),
    (select current_url from site_media where slot='facilities_preview_1'),
    '/images/news/n1.jpg'),
  0, true, true,
  jsonb_build_object('title','Smart Classrooms',
    'description','Technology-enabled classrooms with projectors and digital learning aids for an interactive educational experience.',
    'icon','Monitor','image_url','/images/news/n1.jpg')
where not exists (select 1 from section_cards where section='campus_facilities' and title='Smart Classrooms' and is_default=true);

insert into section_cards (section, title, description, icon, image_url, sort_order, is_active, is_default, default_snapshot)
select 'campus_facilities', 'Science Laboratories',
  'Well-equipped Physics, Chemistry and Biology labs providing hands-on learning opportunities for students.',
  'FlaskConical',
  coalesce(
    (select image_url from section_cards where section='facilities_preview' and title='Science Laboratories' and is_default=true),
    (select current_url from site_media where slot='facilities_preview_2'),
    '/images/news/n2.jpg'),
  1, true, true,
  jsonb_build_object('title','Science Laboratories',
    'description','Well-equipped Physics, Chemistry and Biology labs providing hands-on learning opportunities for students.',
    'icon','FlaskConical','image_url','/images/news/n2.jpg')
where not exists (select 1 from section_cards where section='campus_facilities' and title='Science Laboratories' and is_default=true);

insert into section_cards (section, title, description, icon, image_url, sort_order, is_active, is_default, default_snapshot)
select 'campus_facilities', 'Computer Lab',
  'Modern computer lab with high-speed internet and latest software for digital literacy and programming skills.',
  'Laptop',
  coalesce(
    (select image_url from section_cards where section='facilities_preview' and title='Computer Lab' and is_default=true),
    (select current_url from site_media where slot='facilities_preview_3'),
    '/images/news/n4.jpg'),
  2, true, true,
  jsonb_build_object('title','Computer Lab',
    'description','Modern computer lab with high-speed internet and latest software for digital literacy and programming skills.',
    'icon','Laptop','image_url','/images/news/n4.jpg')
where not exists (select 1 from section_cards where section='campus_facilities' and title='Computer Lab' and is_default=true);

insert into section_cards (section, title, description, icon, image_url, sort_order, is_active, is_default, default_snapshot)
select 'campus_facilities', 'Library',
  'A vast collection of over 10,000 books, periodicals and digital resources fostering a love for reading.',
  'BookOpen',
  coalesce(
    (select image_url from section_cards where section='facilities_preview' and title='Library' and is_default=true),
    (select current_url from site_media where slot='facilities_preview_4'),
    '/images/news/n6.jpg'),
  3, true, true,
  jsonb_build_object('title','Library',
    'description','A vast collection of over 10,000 books, periodicals and digital resources fostering a love for reading.',
    'icon','BookOpen','image_url','/images/news/n6.jpg')
where not exists (select 1 from section_cards where section='campus_facilities' and title='Library' and is_default=true);

insert into section_cards (section, title, description, icon, image_url, sort_order, is_active, is_default, default_snapshot)
select 'campus_facilities', 'Sports Grounds',
  'Expansive playgrounds with facilities for cricket, football, basketball, athletics and more.',
  'Trophy', coalesce((select current_url from site_media where slot='facilities_sports'), '/images/news/n7.jpg'),
  4, true, true,
  jsonb_build_object('title','Sports Grounds',
    'description','Expansive playgrounds with facilities for cricket, football, basketball, athletics and more.',
    'icon','Trophy','image_url','/images/news/n7.jpg')
where not exists (select 1 from section_cards where section='campus_facilities' and title='Sports Grounds' and is_default=true);

insert into section_cards (section, title, description, icon, image_url, sort_order, is_active, is_default, default_snapshot)
select 'campus_facilities', 'Auditorium',
  'State-of-the-art auditorium for cultural events, annual functions and academic seminars.',
  'Theater', coalesce((select current_url from site_media where slot='facilities_auditorium'), '/images/news/n3.jpg'),
  5, true, true,
  jsonb_build_object('title','Auditorium',
    'description','State-of-the-art auditorium for cultural events, annual functions and academic seminars.',
    'icon','Theater','image_url','/images/news/n3.jpg')
where not exists (select 1 from section_cards where section='campus_facilities' and title='Auditorium' and is_default=true);

insert into section_cards (section, title, description, icon, image_url, sort_order, is_active, is_default, default_snapshot)
select 'campus_facilities', 'Indoor Games',
  'Dedicated spaces for table tennis, chess, carrom and other indoor recreational activities.',
  'Gamepad2', coalesce((select current_url from site_media where slot='facilities_indoor_games'), '/images/news/n5.jpg'),
  6, true, true,
  jsonb_build_object('title','Indoor Games',
    'description','Dedicated spaces for table tennis, chess, carrom and other indoor recreational activities.',
    'icon','Gamepad2','image_url','/images/news/n5.jpg')
where not exists (select 1 from section_cards where section='campus_facilities' and title='Indoor Games' and is_default=true);

insert into section_cards (section, title, description, icon, image_url, sort_order, is_active, is_default, default_snapshot)
select 'campus_facilities', 'Transport',
  'Safe and reliable school bus transport covering major routes across Jaipur city.',
  'Bus', coalesce((select current_url from site_media where slot='facilities_transport'), '/images/gallery/g10.jpg'),
  7, true, true,
  jsonb_build_object('title','Transport',
    'description','Safe and reliable school bus transport covering major routes across Jaipur city.',
    'icon','Bus','image_url','/images/gallery/g10.jpg')
where not exists (select 1 from section_cards where section='campus_facilities' and title='Transport' and is_default=true);

delete from site_media where slot in (
  'facilities_sports', 'facilities_auditorium',
  'facilities_indoor_games', 'facilities_transport'
);

commit;


-- =============================================================================
-- Done. Sanity-check counts:
--   SELECT section, COUNT(*) FILTER (WHERE is_default) AS defaults,
--          COUNT(*) FILTER (WHERE NOT is_default) AS user_added
--   FROM section_cards GROUP BY section ORDER BY section;
-- Expected default rows per section:
--   testimonials 3, leadership 3, latest_updates 3, hero_slider 3,
--   facilities_preview 4, why_choose_us 4, legacy_timeline 5,
--   activities 6, annual_events 4, campus_facilities 8.
-- And: SELECT slot FROM site_media ORDER BY slot;
-- Should return only:
--   about_hero, facilities_hero, founder_photo, site_logo, stats_background.
-- =============================================================================
