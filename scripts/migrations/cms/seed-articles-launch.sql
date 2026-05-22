-- Seed: launch articles for the home page "Latest Updates" section.
--
-- Inserts 4 starter articles so the home page renders real, working cards
-- instead of falling back to section_cards placeholders. Idempotent — re-runs
-- are safe (ON CONFLICT on slug skips duplicates).
--
-- Edit titles, dates, content, or cover_image_url BEFORE publishing if any
-- detail doesn't match reality. Set is_published=false on any row you want to
-- hide while keeping it in the table.
--
-- Cover images: pointed at images already in /public/images/news on the
-- website. Swap to gallery URLs (Supabase storage) once those are uploaded.

begin;

-- 1. Admissions
insert into articles (
  slug, title, excerpt, content, cover_image_url, author_name,
  meta_description, tags, is_published, published_at
) values (
  'admissions-open-2026-27',
  'Admissions Open for 2026–27 Academic Session',
  'Applications are now open for Nursery to Class XII for the 2026–27 academic year. Visit the campus or apply online — limited seats available across all streams.',
  $md$NK Public School is pleased to announce that admissions are now open for the **2026–27 academic year** across all classes, from **Nursery through Class XII**.

## Why join NKPS

For four decades, NK Public School has been nurturing students into responsible, confident, and capable citizens. With over **20,000 students**, **300+ dedicated faculty**, and a CBSE-affiliated curriculum, we offer a complete educational experience grounded in discipline, knowledge and character.

## Streams available

- **Pre-Primary (Nursery, LKG, UKG)** — play-based foundational learning
- **Primary (Classes I–V)** — core academics with sports, arts, and life skills
- **Middle (Classes VI–VIII)** — subject specialization begins
- **Secondary (Classes IX–X)** — CBSE board preparation
- **Senior Secondary (Classes XI–XII)** — Science, Commerce, and Humanities streams

## How to apply

1. Visit the campus at Grand Sikar Road, Rajawas, Jaipur between **9 AM and 3 PM (Mon–Sat)**
2. Or call **+91-9785500046** to schedule a visit
3. Required documents: previous school report card, transfer certificate (if applicable), birth certificate, passport-size photographs

Limited seats — early applications are encouraged. We look forward to welcoming your child into the NKPS family.$md$,
  '/images/news/n1.jpg',
  'NK Public School',
  'NK Public School Jaipur is accepting admissions for the 2026–27 academic year, Nursery through Class XII. CBSE affiliated. Apply now.',
  array['admissions','2026-27','new session'],
  true,
  now()
)
on conflict (slug) do nothing;

-- 2. Welcome / new session
insert into articles (
  slug, title, excerpt, content, cover_image_url, author_name,
  meta_description, tags, is_published, published_at
) values (
  'welcome-2026-27',
  'Welcome to the 2026–27 Academic Session',
  'A warm welcome to all students, parents, and staff as we begin a new academic year. Here is what to look forward to in 2026–27.',
  $md$The doors of NK Public School are open once again, and we extend a heartfelt welcome to every student, parent, and member of our staff as we begin the **2026–27 academic year**.

## A fresh start

After the summer break, our classrooms, labs, and playgrounds are ready to come alive again. New uniforms have been distributed, books are stacked, and the corridors echo with the excitement of reunions and new friendships.

## What is ahead this year

- **Academic Calendar:** Available on the [Academic Calendar](/academic-calendar) page. Key dates include Term 1 exams, mid-term holidays, and the Annual Function.
- **New initiatives:** Expanded STEM and robotics activities for Classes VI–X, new electives at the senior secondary level.
- **Sports & co-curriculars:** Inter-house competitions, the annual sports meet, science exhibition, and our flagship cultural festival.

## A message from the Principal

> "At NK Public School, we believe every child is unique. This year, our dedicated faculty is committed to ensuring every student finds their voice — academically, socially, and creatively. Let us walk this journey together."
> — **Mrs. Prema Kavia, Principal**

We wish every student a meaningful, joyful, and rewarding year ahead.$md$,
  '/images/news/n2.jpg',
  'NK Public School',
  'NK Public School welcomes students, parents, and staff to the 2026–27 academic year. Highlights of the new session, calendar, and what is ahead.',
  array['new session','school life','2026-27'],
  true,
  now() - interval '1 day'
)
on conflict (slug) do nothing;

-- 3. Sports meet
insert into articles (
  slug, title, excerpt, content, cover_image_url, author_name,
  meta_description, tags, is_published, published_at
) values (
  'annual-sports-meet-2026',
  'Annual Sports Meet — Celebrating Strength, Spirit, and Sportsmanship',
  'Our students lit up the field in this year''s Annual Sports Meet with track events, team sports, and an unforgettable closing ceremony. Here is a recap.',
  $md$The annual sports meet at **NK Public School** is one of the most awaited days of our calendar — and this year did not disappoint. From the opening march-past to the final relay, our students gave everything to the field.

## Events that thrilled

The meet featured the full spectrum of athletics and team sports:

- **Track:** 100m, 200m, 400m, and the senior-school relay
- **Field:** Long jump, shot put, javelin
- **Team sports:** Kabaddi, kho-kho, basketball, and football finals
- **Junior wing:** Sack race, three-legged race, and the ever-popular tug-of-war

## House standings

The four houses competed fiercely for the overall trophy. Points were awarded across age groups for individual placements and team events. Winners were felicitated at the closing ceremony with medals and certificates.

## More than medals

What makes our sports meet special is not the wins, but the *spirit* — students cheering for each other across houses, helping fallen runners back up, and applauding effort over outcome. That is the NKPS way.

A huge thank-you to our PE department, the parent volunteers, and every student who participated. See you next year on the track.$md$,
  '/images/news/n3.jpg',
  'NK Public School',
  'Highlights from the NK Public School Annual Sports Meet — track and field events, winners, and the spirit of sportsmanship across our houses.',
  array['sports','events','school life'],
  true,
  now() - interval '2 days'
)
on conflict (slug) do nothing;

-- 4. Science exhibition
insert into articles (
  slug, title, excerpt, content, cover_image_url, author_name,
  meta_description, tags, is_published, published_at
) values (
  'science-exhibition-young-innovators',
  'NKPS Science Exhibition — Young Innovators Take the Stage',
  'From working models of solar systems to working prototypes of water purifiers, our Science Exhibition showcased the curiosity and ingenuity of our students.',
  $md$Science is not a subject at NK Public School — it is a way of asking questions. Our annual **Science Exhibition** turned the school auditorium into a buzzing lab of young researchers showing what they had been working on for weeks.

## Projects that stood out

Across grades, students explored a wide range of themes:

- **Primary wing:** Volcanoes, the solar system, water cycle dioramas, and simple electric circuits
- **Middle wing:** DNA models, plant cell anatomy, working pulleys, and rainwater harvesting demonstrations
- **Senior wing:** A working water purifier using activated charcoal, an Arduino-based smart traffic system, and a study on local soil quality

## What we look for

Judges — invited from local engineering colleges and the school's senior faculty — evaluated projects on **scientific accuracy**, **originality**, **presentation**, and the student's ability to **answer follow-up questions** about their work. The point is not to copy a textbook diagram; it is to *understand* it.

## Looking ahead

Three of our senior wing projects have been recommended for the upcoming state-level science fair. We wish those students every success and thank every participant — every project shown here, regardless of placement, represents real learning.

> "When a student explains their own model in their own words, that is when science becomes theirs." — Science department

Stay curious, NKPS family.$md$,
  '/images/news/n4.jpg',
  'NK Public School',
  'Highlights from the annual Science Exhibition at NK Public School — student projects, winning models, and how we nurture scientific thinking.',
  array['science','exhibition','achievements','STEM'],
  true,
  now() - interval '3 days'
)
on conflict (slug) do nothing;

commit;

-- Quick verification — run this after to confirm:
-- select slug, title, is_published, published_at from articles order by published_at desc;
