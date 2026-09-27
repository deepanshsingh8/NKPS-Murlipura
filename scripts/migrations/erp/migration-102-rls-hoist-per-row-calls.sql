-- migration-102-rls-hoist-per-row-calls.sql
--
-- WHY --------------------------------------------------------------------
-- Every RLS policy in this database calls its helper as a bare scalar:
--
--     USING (get_user_role() = 'admin')
--
-- Postgres cannot hoist that. Two things make it expensive here:
--
--   1. The call is not wrapped in a scalar subselect, so it is re-evaluated
--      ONCE PER ROW SCANNED rather than once per query.
--   2. The helpers are SECURITY DEFINER. The planner refuses to inline a SQL
--      function when prosecdef is true, so each call is a real function
--      invocation running its own `SELECT role FROM profiles WHERE id = ...`.
--
-- Measured on this database (944 students; anon vs service-role; medians of
-- 11 runs):
--
--     students              110ms -> 388ms    (+277ms of pure RLS CPU)
--     student_enrollments   113ms -> 387ms    (+273ms)
--     timetable_periods     111ms -> 111ms    (  +0ms - no helper in its policy)
--     fee_structures        109ms -> 110ms    (  +0ms)
--
-- Linear in rows scanned, which proves per-row evaluation:
--       1 row (PK lookup)  -> +4ms
--     944 rows (full scan) -> +209ms
-- Extrapolated: ~1.5s of RLS CPU per query at 5,000 students.
--
-- THE FIX ----------------------------------------------------------------
-- Wrapping the call as (SELECT get_user_role()) makes it an uncorrelated
-- InitPlan: evaluated once per query, reused for every row. The helpers are
-- STABLE and take no arguments, so this is EXACTLY semantics-preserving.
-- No policy's meaning changes.
--
-- WHY THIS IS A DO BLOCK AND NOT A LIST OF DROP/CREATE --------------------
-- supabase-schema.sql is NOT a faithful mirror of the live policy set.
-- migration-erp-redesign.sql drops the original policy names ("Users can read
-- own profile", ...) and replaces them with a different scheme
-- (profiles_select_own, students_select_admin, ...), and that rename was never
-- mirrored into supabase-schema.sql - the file still lists only the old names
-- and none of the new ones. The redesign demonstrably ran: the teachers /
-- parents / payment_orders / notifications tables it creates are live.
--
-- So a hand-written DROP POLICY "<old name>" + CREATE POLICY would DROP
-- nothing (the name is not there) and CREATE a SECOND policy alongside the
-- live one. Permissive policies are OR-ed, so that would WIDEN ACCESS.
--
-- Rewriting from pg_policies instead means we transform whatever is actually
-- installed, whatever it is called. It is correct under drift by construction.
--
-- SAFETY PROPERTIES ------------------------------------------------------
--   * ALTER POLICY only - never creates or drops a policy, so the policy set
--     is identical before and after. Only the expression text changes.
--   * Idempotent: an already-wrapped call is left alone (sentinel guard), so
--     re-running is a no-op.
--   * Every statement is RAISE NOTICE'd before execution, so the migration
--     output is a full audit of what changed.
--   * Scoped to the tables where the cost was actually measured.
--
-- WHAT IS DELIBERATELY NOT TOUCHED ---------------------------------------
--   * `IN (SELECT get_my_class_ids())` / get_my_children_ids(). A
--     set-returning function inside IN (SELECT ...) is ALREADY an
--     uncorrelated InitPlan. Correct as written - do not "fix" these.
--   * teachers / staff_members - migration-098-restrict-staff-pii.sql is
--     concurrently rewriting those to close an unauthenticated read. Doing
--     them here would race that fix. Follow-up once 098 lands.
--   * The tail of low-traffic master/CMS tables. All the measured cost is on
--     the tables listed below.
--
-- VERIFY AFTER APPLYING --------------------------------------------------
--   -- 1. confirm nothing is left un-wrapped on these tables:
--   SELECT tablename, policyname, qual FROM pg_policies
--    WHERE schemaname='public'
--      AND (qual ~ '(?<![T] )get_user_role' OR with_check ~ 'get_user_role');
--   -- 2. as an authenticated non-admin:
--   EXPLAIN (ANALYZE, BUFFERS) SELECT id FROM students;
--   -- the tell is get_user_role collapsing to `InitPlan 1`.
--   -- Expect students to drop ~388ms -> ~115ms.
-- ─────────────────────────────────────────────────────────────────────────

BEGIN;

DO $mig$
DECLARE
  r        record;
  q        text;
  w        text;
  stmt     text;
  changed  int := 0;
  scanned  int := 0;
  -- Scalar, zero-argument, STABLE helpers. Set-returning helpers
  -- (get_my_class_ids, get_my_children_ids) are excluded on purpose.
  fns text[] := ARRAY[
    'get_user_role',
    'get_my_student_id',
    'get_my_teacher_id',
    'get_my_parent_id'
  ];
  fn   text;
  tabs text[] := ARRAY[
    'profiles','students','student_enrollments','results','attendance',
    'fee_payments','parents','report_presets','student_subjects',
    'class_tests','class_test_results','non_scholastic_assessments',
    'student_remarks','ptm_notes','supplementary_attempts'
  ];
BEGIN
  FOR r IN
    SELECT tablename, policyname, qual, with_check
      FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename = ANY(tabs)
     ORDER BY tablename, policyname
  LOOP
    scanned := scanned + 1;
    q := r.qual;
    w := r.with_check;

    FOREACH fn IN ARRAY fns LOOP
      -- Order matters. Park already-wrapped and schema-qualified forms behind
      -- sentinels first, so the bare replacement cannot corrupt them into
      -- `public.(SELECT f())` or double-wrap an existing `(SELECT f())`.
      q := replace(q, '( SELECT '||fn||'()',        '@@W@@'||fn);
      q := replace(q, '(SELECT '||fn||'()',         '@@W@@'||fn);
      q := replace(q, '( SELECT public.'||fn||'()', '@@P@@'||fn);
      q := replace(q, '(SELECT public.'||fn||'()',  '@@P@@'||fn);
      q := replace(q, 'public.'||fn||'()',          '@@Q@@'||fn);
      q := replace(q, fn||'()',            '(SELECT '||fn||'())');
      q := replace(q, '@@Q@@'||fn,         '(SELECT public.'||fn||'())');
      q := replace(q, '@@P@@'||fn,         '(SELECT public.'||fn||'()');
      q := replace(q, '@@W@@'||fn,         '(SELECT '||fn||'()');

      w := replace(w, '( SELECT '||fn||'()',        '@@W@@'||fn);
      w := replace(w, '(SELECT '||fn||'()',         '@@W@@'||fn);
      w := replace(w, '( SELECT public.'||fn||'()', '@@P@@'||fn);
      w := replace(w, '(SELECT public.'||fn||'()',  '@@P@@'||fn);
      w := replace(w, 'public.'||fn||'()',          '@@Q@@'||fn);
      w := replace(w, fn||'()',            '(SELECT '||fn||'())');
      w := replace(w, '@@Q@@'||fn,         '(SELECT public.'||fn||'())');
      w := replace(w, '@@P@@'||fn,         '(SELECT public.'||fn||'()');
      w := replace(w, '@@W@@'||fn,         '(SELECT '||fn||'()');
    END LOOP;

    -- auth.uid() gets the same treatment.
    q := replace(q, '( SELECT auth.uid()', '@@A@@');
    q := replace(q, '(SELECT auth.uid()',  '@@A@@');
    q := replace(q, 'auth.uid()',          '(SELECT auth.uid())');
    q := replace(q, '@@A@@',               '(SELECT auth.uid()');
    w := replace(w, '( SELECT auth.uid()', '@@A@@');
    w := replace(w, '(SELECT auth.uid()',  '@@A@@');
    w := replace(w, 'auth.uid()',          '(SELECT auth.uid())');
    w := replace(w, '@@A@@',               '(SELECT auth.uid()');

    CONTINUE WHEN q IS NOT DISTINCT FROM r.qual
              AND w IS NOT DISTINCT FROM r.with_check;

    stmt := format('ALTER POLICY %I ON public.%I', r.policyname, r.tablename);
    IF q IS NOT NULL THEN stmt := stmt || format(' USING (%s)', q); END IF;
    IF w IS NOT NULL THEN stmt := stmt || format(' WITH CHECK (%s)', w); END IF;

    RAISE NOTICE '%;', stmt;
    EXECUTE stmt;
    changed := changed + 1;
  END LOOP;

  RAISE NOTICE 'migration-102: scanned % policies, rewrote %.', scanned, changed;

  IF changed = 0 THEN
    RAISE WARNING 'migration-102 changed nothing. Either it has already been '
                  'applied, or the helper names differ from those expected.';
  END IF;
END
$mig$;

-- ─────────────────────────────────────────────────────────────────────────
-- BUG FIX (a real behaviour change, not a rewrite)
--
-- The teacher policy on student_subjects compares class_subjects.teacher_id
-- against auth.uid(). But class_subjects.teacher_id REFERENCES teachers(id),
-- while auth.uid() is profiles.id / auth.users.id - two different UUID
-- spaces. The predicate is ALWAYS FALSE, so teachers see ZERO
-- student_subjects rows today. Every other policy in the schema correctly
-- uses get_my_teacher_id() for this.
--
-- Written defensively: the redesign may have renamed this policy, so we fix
-- whichever policy on student_subjects still carries the broken comparison.
-- ─────────────────────────────────────────────────────────────────────────
DO $fix$
DECLARE r record; q text; n int := 0;
BEGIN
  FOR r IN
    SELECT policyname, qual FROM pg_policies
     WHERE schemaname='public' AND tablename='student_subjects'
       AND qual LIKE '%teacher_id%' AND qual LIKE '%auth.uid()%'
  LOOP
    q := replace(r.qual, 'teacher_id = (SELECT auth.uid())',
                         'teacher_id = (SELECT get_my_teacher_id())');
    q := replace(q,      'teacher_id = auth.uid()',
                         'teacher_id = (SELECT get_my_teacher_id())');
    CONTINUE WHEN q = r.qual;
    RAISE NOTICE 'BUGFIX ALTER POLICY %I ON student_subjects USING (%)', r.policyname, q;
    EXECUTE format('ALTER POLICY %I ON public.student_subjects USING (%s)', r.policyname, q);
    n := n + 1;
  END LOOP;
  RAISE NOTICE 'migration-102 bugfix: repaired % student_subjects policy(ies).', n;
END
$fix$;

COMMIT;
