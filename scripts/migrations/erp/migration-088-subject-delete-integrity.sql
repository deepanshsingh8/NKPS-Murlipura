-- =============================================================================
-- Migration 088 — Subject delete integrity
-- =============================================================================
-- Admins reported "Failed to delete subject" on /academics/subjects for any
-- subject that appears anywhere in a timetable.
--
-- Cause: timetable_periods.subject_id was created without an ON DELETE action,
-- so it defaulted to NO ACTION. Every other foreign key pointing at
-- subjects(id) — class_subjects, stream_subjects, results, exam_schedules,
-- result_master_subjects, class_tests, supplementary_attempts,
-- elective_slot_options, student_elective_picks — is ON DELETE CASCADE. The
-- odd one out turned a supported action into a 23503 the UI surfaced as a bare
-- "Failed to delete subject" with no reason.
--
-- Fix: bring the FK in line with its nine siblings. Deleting a subject now
-- removes the periods that taught it, which is what the page's confirmation
-- has always promised. Break periods (is_break = true) carry a NULL subject_id
-- and are untouched — a cascade only reaches rows whose subject_id matches the
-- deleted subject.
--
-- Marks are NOT protected by this FK and never were: results, class_tests and
-- supplementary_attempts all cascade. That protection now lives in the admin
-- proxy, which refuses any delete that would strand academic records
-- (packages/shared/src/lib/row-dependencies.ts). The DB stays permissive so
-- an intentional admin cleanup is still possible via SQL.
--
-- Idempotent: safe to re-run.
-- =============================================================================

ALTER TABLE timetable_periods
  DROP CONSTRAINT IF EXISTS timetable_periods_subject_id_fkey;

ALTER TABLE timetable_periods
  ADD CONSTRAINT timetable_periods_subject_id_fkey
  FOREIGN KEY (subject_id) REFERENCES subjects(id) ON DELETE CASCADE;

-- Verification — expect delete_rule = 'CASCADE'.
--
--   SELECT rc.delete_rule
--     FROM information_schema.referential_constraints rc
--    WHERE rc.constraint_name = 'timetable_periods_subject_id_fkey';
