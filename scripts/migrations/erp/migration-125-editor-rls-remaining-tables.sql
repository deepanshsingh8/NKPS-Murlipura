-- Migration 125 — finish the job 084 and 124 started: a granted feature works.
--
-- ── Why ─────────────────────────────────────────────────────────────────────
-- Admin-area screens read their data straight from the browser with the user's
-- own JWT, so Postgres applies RLS. Where a table has no policy admitting the
-- caller, RLS FILTERS ROWS RATHER THAN RAISING — the page renders, the read
-- returns nothing, and the screen shows its "nothing found" empty state. There
-- is no error anywhere to tell the operator, or the admin who granted the
-- feature, that anything is wrong. That is the whole failure mode: a feature
-- ticked on /people/users that silently does nothing.
--
-- Migration 084 fixed this for students and student_enrollments. Migration 124
-- fixed fee_payments and introduced has_editor_capability(). This one closes
-- the remainder, so the rule holds without exception: if a staff member is
-- granted a feature, the screens for that feature work.
--
-- ── The audit behind this list ──────────────────────────────────────────────
-- Every table read client-side from apps/erp/src/app/(admin)/** and from the
-- client components those pages mount was enumerated and its policy set
-- checked. Thirty tables already admit a staff caller and are deliberately
-- untouched here:
--
--   readable by anyone      academic_years, classes, class_subjects, subjects,
--                           streams, stream_subjects, exam_types, houses,
--                           timetable_periods, teachers, teacher_subjects,
--                           staff_members, fee_structures, calendar_events,
--                           grade_scales, grade_bands, class_grade_scales,
--                           exam_schedules, non_scholastic_subjects,
--                           non_scholastic_sub_subjects, bus_stops, buses,
--                           bus_route_stops, bus_stop_fees
--   explicit staff policy   students, student_enrollments (084), profiles
--   feature-gated           fee_payments (124)
--   self-read               editor_permissions
--
-- That leaves the five below — every one of them admin + teacher + student +
-- parent, with no path for a staff member however they were granted:
--
--   attendance                  /attendance                        'attendance'
--   results                     /exams/results                     'results'
--   non_scholastic_assessments  /exams/non-scholastic-assessments  'non_scholastic_entry'
--   marksheet_publications      /exams/publish                     'publish_results'
--   ptm_notes                   /exams/ptm-notes                   'ptm_notes'
--
-- Each key is the one the middleware gate already requires for that path, so a
-- policy grants exactly what ticking that box on /people/users promises — and
-- nothing else. A staff member granted Attendance still cannot read marks.
--
-- ── SELECT only, deliberately ───────────────────────────────────────────────
-- Not one of these five is written from the browser: marks entry, attendance
-- marking, publishing and PTM notes all post to server routes that run
-- verifyAdminOrEditor() on the service-role client. Adding INSERT/UPDATE here
-- would create a second, weaker way in that skips those checks. Read access is
-- the entire defect and the entire fix.
--
-- Unlike the student and parent policies on results and
-- non_scholastic_assessments, these carry NO is_published filter. An editor
-- entering and checking marks has to see them before they are published —
-- that is what the screen is for — which is why the admin policy has no such
-- filter either.
--
-- ── Additive by construction ────────────────────────────────────────────────
-- supabase-schema.sql is not a faithful mirror of the live policy set: the
-- redesign renamed these policies and the rename was never mirrored back (see
-- migration 102's header). Every statement below drops and creates only its
-- OWN new name, so it cannot disturb whatever a given deployment carries.
-- Permissive policies are OR-ed, so each adds exactly its predicate.
--
-- Every call is wrapped as (SELECT has_editor_capability(…)) so it is an
-- uncorrelated InitPlan — evaluated once per query rather than once per row
-- scanned. Migration 102 measured why that matters.
--
-- Requires migration 124 (has_editor_capability). SAFE TO RE-RUN.

BEGIN;

DO $mig$
BEGIN
  IF to_regprocedure('public.has_editor_capability(text)') IS NULL THEN
    RAISE EXCEPTION
      'has_editor_capability(text) is missing — apply migration 124 first.';
  END IF;
END
$mig$;

-- ─── attendance ─────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "attendance_select_editor" ON public.attendance;
CREATE POLICY "attendance_select_editor"
  ON public.attendance FOR SELECT
  USING ((SELECT public.has_editor_capability('attendance')));

-- ─── results ────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "results_select_editor" ON public.results;
CREATE POLICY "results_select_editor"
  ON public.results FOR SELECT
  USING ((SELECT public.has_editor_capability('results')));

-- ─── non_scholastic_assessments ─────────────────────────────────────────────
DROP POLICY IF EXISTS "non_scholastic_assessments_select_editor"
  ON public.non_scholastic_assessments;
CREATE POLICY "non_scholastic_assessments_select_editor"
  ON public.non_scholastic_assessments FOR SELECT
  USING ((SELECT public.has_editor_capability('non_scholastic_entry')));

-- ─── marksheet_publications ─────────────────────────────────────────────────
DROP POLICY IF EXISTS "marksheet_publications_select_editor"
  ON public.marksheet_publications;
CREATE POLICY "marksheet_publications_select_editor"
  ON public.marksheet_publications FOR SELECT
  USING ((SELECT public.has_editor_capability('publish_results')));

-- ─── ptm_notes ──────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "ptm_notes_select_editor" ON public.ptm_notes;
CREATE POLICY "ptm_notes_select_editor"
  ON public.ptm_notes FOR SELECT
  USING ((SELECT public.has_editor_capability('ptm_notes')));

COMMIT;

-- ── VERIFY ──────────────────────────────────────────────────────────────────
-- Grant a test staff account one feature at a time on /people/users and check
-- that its screen fills and no other does. Or, in SQL as that user:
--
--   SELECT count(*) FROM attendance;   -- non-zero only with 'attendance'
--   SELECT count(*) FROM results;      -- non-zero only with 'results'
--
-- And confirm the check is hoisted rather than run per row:
--
--   EXPLAIN (ANALYZE) SELECT id FROM results;
--   -- has_editor_capability should appear as an InitPlan, not in a per-row filter.
