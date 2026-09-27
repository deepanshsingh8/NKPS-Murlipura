-- _unseed-ai-test-fixture.sql
--
-- Removes exactly what _seed-ai-test-fixture.sql created, and nothing else.
--
-- Every deletion is keyed on a tag the fixture set, so real attendance and
-- real parent links are untouchable by this script. Run it the moment the
-- fixture has served its purpose — leaving fake attendance in a live database
-- is how a fake number ends up on a real report card.

BEGIN;

-- Attendance: only rows the fixture tagged. Anything an actual teacher marked
-- has remarks NULL or their own text and is not matched.
DELETE FROM attendance WHERE remarks = 'ai-test-fixture';

-- Parent links, then the parent. Order matters: student_parents has an FK.
DELETE FROM student_parents
WHERE parent_id IN (
  SELECT id FROM parents WHERE email = 'ai-test-fixture@example.invalid'
);

DELETE FROM parents WHERE email = 'ai-test-fixture@example.invalid';

COMMIT;

-- All three counts must be 0.
SELECT 'attendance left'      AS item, count(*)::text AS n FROM attendance WHERE remarks = 'ai-test-fixture'
UNION ALL
SELECT 'parents left',   count(*)::text FROM parents WHERE email = 'ai-test-fixture@example.invalid'
UNION ALL
SELECT 'links left',     count(*)::text FROM student_parents sp
  JOIN parents p ON p.id = sp.parent_id WHERE p.email = 'ai-test-fixture@example.invalid';
