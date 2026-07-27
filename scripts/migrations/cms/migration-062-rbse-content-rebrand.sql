-- Migration 062: Rebrand board affiliation from CBSE to RBSE across the
-- CMS-managed content (section_cards) and articles.
--
-- The school is affiliated to the state board (RBSE — Board of Secondary
-- Education, Rajasthan), not CBSE. Earlier default seeds (migrations 053, 055,
-- 056, 061 and the seed scripts) inserted CBSE wording. This migration rewrites
-- the live rows in place. Hard-coded website copy is fixed directly in the
-- component/lib source — this file only covers the database-driven copy.
--
-- Replacement rules (order matters — applied left-to-right by nested replace):
--   1. "CBSE Curriculum"  -> "RBSE based Curriculum"
--   2. "CBSE affiliated"  -> "State Board affiliated"  (any case seen in seeds)
--   3. remaining "CBSE"    -> "RBSE"
--
-- Idempotent: only rows that still contain "CBSE" are touched, so re-running is
-- a no-op.

begin;

-- 1. section_cards — title / subtitle / description columns.
update section_cards
set
  title = replace(
            replace(
              replace(
                replace(title, 'CBSE Curriculum', 'RBSE based Curriculum'),
              'CBSE-affiliated', 'State Board affiliated'),
            'CBSE affiliated', 'State Board affiliated'),
          'CBSE', 'RBSE'),
  subtitle = replace(
               replace(
                 replace(
                   replace(subtitle, 'CBSE Curriculum', 'RBSE based Curriculum'),
                 'CBSE-affiliated', 'State Board affiliated'),
               'CBSE affiliated', 'State Board affiliated'),
             'CBSE', 'RBSE'),
  description = replace(
                  replace(
                    replace(
                      replace(description, 'CBSE Curriculum', 'RBSE based Curriculum'),
                    'CBSE-affiliated', 'State Board affiliated'),
                  'CBSE affiliated', 'State Board affiliated'),
                'CBSE', 'RBSE')
where title like '%CBSE%'
   or subtitle like '%CBSE%'
   or description like '%CBSE%';

-- 2. Relabel the sports accolade: "National Sports Champions" -> "Sports Champions".
update section_cards
set title = 'Sports Champions'
where section = 'accolades'
  and title = 'National Sports Champions';

-- 3. Article title using the same label.
update articles
set title = 'Sports Champions from NKPS Murlipura'
where title = 'National Sports Champions from NKPS Murlipura';

commit;
