-- _seed-ai-test-fixture.sql
--
-- OPTIONAL. Test data so the assistant can actually be exercised.
--
-- ── Read this before running it ─────────────────────────────────────────────
-- This writes to your PRODUCTION database. It is offered because the AI
-- features read attendance, results and parent links, and your database has
-- none of any of them — so most of the feature currently cannot be tested at
-- all, only compiled.
--
-- Every row it creates is tagged, and _unseed-ai-test-fixture.sql removes
-- exactly those rows and nothing else:
--
--   attendance      remarks = 'ai-test-fixture'
--   parents         email   = 'ai-test-fixture@example.invalid'
--   student_parents (only the rows pointing at that parent)
--
-- It touches ONE class — the smallest active one — not the whole school.
--
-- ── What it deliberately does NOT seed ──────────────────────────────────────
-- Marks. Making `results` meaningful needs a result_master, its subject rows
-- and per-exam configs — the rules engine that decides pass criteria, grace
-- marks, weightage and grade scales. Faking that would test the assistant
-- against a configuration your school would never actually use, and a
-- report-card remark grounded in a fake rules engine tells you nothing about
-- the real one. Enter one exam's marks through the normal exam-department
-- screens instead; the remark drafter will then have real ground truth.
--
-- Attendance and the parent link have no such machinery behind them, which is
-- why they are safe to fake.

BEGIN;

-- ── The class we operate on ─────────────────────────────────────────────────
-- PRESERVE ROWS, not ON COMMIT DROP: the summary at the bottom runs after
-- COMMIT and needs to read this. It still disappears when the session ends.
CREATE TEMP TABLE _fixture_class ON COMMIT PRESERVE ROWS AS
SELECT c.id AS class_id,
       c.academic_year_id,
       c.name || COALESCE('-' || c.section, '') AS label,
       count(e.student_id) AS students
FROM classes c
JOIN academic_years y
  ON y.id = c.academic_year_id AND y.is_current
JOIN student_enrollments e
  ON e.class_id = c.id AND e.status = 'active'
GROUP BY c.id, c.academic_year_id, c.name, c.section
HAVING count(e.student_id) BETWEEN 5 AND 45
ORDER BY count(e.student_id)
LIMIT 1;

-- ── Attendance: last 60 weekdays, up to today ───────────────────────────────
-- Absence is deterministic (hashed on student + date), so re-running produces
-- the same picture. Roughly a quarter of the class is pushed below 75%, which
-- is the threshold the assistant is told to mention — otherwise the "flag low
-- attendance" behaviour never fires and the test proves nothing.
INSERT INTO attendance (student_id, class_id, date, status, remarks)
SELECT
  s.student_id,
  f.class_id,
  d::date,
  CASE
    WHEN ((hashtext(s.student_id::text || d::text) % 100) + 100) % 100
         < CASE WHEN s.rn % 4 = 0 THEN 35 ELSE 8 END
    THEN 'absent'
    WHEN ((hashtext(s.student_id::text || d::text) % 100) + 100) % 100 < 12 THEN 'late'
    ELSE 'present'
  END,
  'ai-test-fixture'
FROM _fixture_class f
CROSS JOIN LATERAL (
  SELECT e.student_id, row_number() OVER (ORDER BY e.student_id) AS rn
  FROM student_enrollments e
  WHERE e.class_id = f.class_id AND e.status = 'active'
) s
CROSS JOIN LATERAL generate_series(
  greatest(current_date - 85, (SELECT start_date FROM academic_years WHERE id = f.academic_year_id)),
  least(current_date, (SELECT end_date FROM academic_years WHERE id = f.academic_year_id)),
  interval '1 day'
) AS d
WHERE extract(isodow FROM d) < 7          -- Mon-Sat; Indian schools sit Saturdays
ON CONFLICT (student_id, class_id, date) DO NOTHING;

-- ── One parent, linked to two children in that class ────────────────────────
-- Enough to exercise "which child do you mean?", and to prove a sibling's
-- details never leak into an answer about the other.
INSERT INTO parents (full_name, email, phone, relationship)
VALUES ('AI Test Parent', 'ai-test-fixture@example.invalid', '+919999900001', 'father')
ON CONFLICT (email) DO NOTHING;

INSERT INTO student_parents (student_id, parent_id, relationship, is_primary_contact)
SELECT s.student_id,
       (SELECT id FROM parents WHERE email = 'ai-test-fixture@example.invalid'),
       'father',
       s.rn = 1
FROM (
  SELECT e.student_id, row_number() OVER (ORDER BY e.student_id) AS rn
  FROM student_enrollments e
  JOIN _fixture_class f ON f.class_id = e.class_id
  WHERE e.status = 'active'
  LIMIT 2
) s
ON CONFLICT (student_id, parent_id) DO NOTHING;

COMMIT;

-- ── What you just created ───────────────────────────────────────────────────
SELECT 'class'            AS item, label            AS detail, students::text AS n FROM _fixture_class
UNION ALL
SELECT 'attendance rows', 'tagged ai-test-fixture', count(*)::text FROM attendance WHERE remarks = 'ai-test-fixture'
UNION ALL
SELECT 'students below 75%', 'should be > 0', count(*)::text FROM (
  SELECT student_id
  FROM attendance
  WHERE remarks = 'ai-test-fixture'
  GROUP BY student_id
  HAVING count(*) FILTER (WHERE status IN ('present','late','half_day'))::numeric
         / nullif(count(*), 0) < 0.75
) low
UNION ALL
SELECT 'parent links', 'AI Test Parent', count(*)::text
FROM student_parents sp
JOIN parents p ON p.id = sp.parent_id
WHERE p.email = 'ai-test-fixture@example.invalid';
