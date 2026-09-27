-- Migration 121 — a teacher may write marks only for a class-subject they hold.
--
-- ── The hole ────────────────────────────────────────────────────────────────
-- Seven policies gate a teacher writing marks, and each pairs two clauses that
-- are never tied to each other:
--
--     AND class_id   IN (SELECT public.get_my_class_ids())
--     AND subject_id IN (SELECT subject_id FROM class_subjects
--                        WHERE teacher_id = public.get_my_teacher_id())
--
-- The first means "a class I teach something in". The second means "a subject I
-- teach SOMEWHERE". Nothing requires them to be the same assignment. So a
-- teacher who takes Maths in VI-A and Games in VII-B satisfies both for Games
-- marks in VI-A — a pairing they do not teach and nobody intended.
--
-- Not reachable through the app: every write to results, class_tests and
-- class_test_results goes through a server route, and those routes already call
-- teacherTeachesClassSubject(), which correlates properly. RLS is the backstop
-- for a hand-crafted PostgREST call carrying a teacher's own token, which is
-- exactly the case it exists to cover.
--
-- Parallel groups (migration 119) widen it in practice rather than causing it:
-- every additional coach who gains a class_subjects row gains another subject
-- in that second clause.
--
-- ── The fix ─────────────────────────────────────────────────────────────────
-- One correlated EXISTS in place of the two loose IN clauses. The class term is
-- no longer needed separately — a matching class_subjects row proves both
-- halves at once, and proves they belong together.
--
-- SELECT policies are deliberately untouched: a teacher may still READ
-- everything for a class they teach in, which is what the mark-entry screens
-- load. Only the write side narrows.
--
-- This REMOVES access, so it was checked against a scratch Postgres before
-- shipping — see the migration's companion notes in the phase commit.
--
-- Depends on nothing from 118/119/120 — it only rewrites RLS policies over
-- class_subjects, results, class_tests and class_test_results, all of which
-- long predate this work. It can be applied on its own, in any order.
--
-- SAFE TO RE-RUN.

BEGIN;

-- ── results ─────────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "Teachers can insert results for their class-subject combos" ON results;
CREATE POLICY "Teachers can insert results for their class-subject combos"
  ON results FOR INSERT
  WITH CHECK (
    public.get_user_role() = 'teacher'
    AND EXISTS (
      SELECT 1 FROM public.class_subjects cs
       WHERE cs.class_id   = results.class_id
         AND cs.subject_id = results.subject_id
         AND cs.teacher_id = public.get_my_teacher_id()
    )
  );

DROP POLICY IF EXISTS "Teachers can update results for their class-subject combos" ON results;
CREATE POLICY "Teachers can update results for their class-subject combos"
  ON results FOR UPDATE
  USING (
    public.get_user_role() = 'teacher'
    AND EXISTS (
      SELECT 1 FROM public.class_subjects cs
       WHERE cs.class_id   = results.class_id
         AND cs.subject_id = results.subject_id
         AND cs.teacher_id = public.get_my_teacher_id()
    )
  );

-- ── class_tests ─────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "Teachers can insert class_tests for their class-subject combos" ON class_tests;
CREATE POLICY "Teachers can insert class_tests for their class-subject combos"
  ON class_tests FOR INSERT
  WITH CHECK (
    public.get_user_role() = 'teacher'
    AND EXISTS (
      SELECT 1 FROM public.class_subjects cs
       WHERE cs.class_id   = class_tests.class_id
         AND cs.subject_id = class_tests.subject_id
         AND cs.teacher_id = public.get_my_teacher_id()
    )
  );

DROP POLICY IF EXISTS "Teachers can update class_tests for their class-subject combos" ON class_tests;
CREATE POLICY "Teachers can update class_tests for their class-subject combos"
  ON class_tests FOR UPDATE
  USING (
    public.get_user_role() = 'teacher'
    AND EXISTS (
      SELECT 1 FROM public.class_subjects cs
       WHERE cs.class_id   = class_tests.class_id
         AND cs.subject_id = class_tests.subject_id
         AND cs.teacher_id = public.get_my_teacher_id()
    )
  );

DROP POLICY IF EXISTS "Teachers can delete class_tests for their class-subject combos" ON class_tests;
CREATE POLICY "Teachers can delete class_tests for their class-subject combos"
  ON class_tests FOR DELETE
  USING (
    public.get_user_role() = 'teacher'
    AND EXISTS (
      SELECT 1 FROM public.class_subjects cs
       WHERE cs.class_id   = class_tests.class_id
         AND cs.subject_id = class_tests.subject_id
         AND cs.teacher_id = public.get_my_teacher_id()
    )
  );

-- ── class_test_results ──────────────────────────────────────────────────────
-- Keyed through the parent test, so the EXISTS correlates on ITS columns.

DROP POLICY IF EXISTS "Teachers can insert class_test_results for their class-subject combos" ON class_test_results;
CREATE POLICY "Teachers can insert class_test_results for their class-subject combos"
  ON class_test_results FOR INSERT
  WITH CHECK (
    public.get_user_role() = 'teacher'
    AND EXISTS (
      SELECT 1
        FROM public.class_tests ct
        JOIN public.class_subjects cs
          ON cs.class_id   = ct.class_id
         AND cs.subject_id = ct.subject_id
       WHERE ct.id = class_test_results.class_test_id
         AND cs.teacher_id = public.get_my_teacher_id()
    )
  );

DROP POLICY IF EXISTS "Teachers can update class_test_results for their class-subject combos" ON class_test_results;
CREATE POLICY "Teachers can update class_test_results for their class-subject combos"
  ON class_test_results FOR UPDATE
  USING (
    public.get_user_role() = 'teacher'
    AND EXISTS (
      SELECT 1
        FROM public.class_tests ct
        JOIN public.class_subjects cs
          ON cs.class_id   = ct.class_id
         AND cs.subject_id = ct.subject_id
       WHERE ct.id = class_test_results.class_test_id
         AND cs.teacher_id = public.get_my_teacher_id()
    )
  );

COMMIT;
