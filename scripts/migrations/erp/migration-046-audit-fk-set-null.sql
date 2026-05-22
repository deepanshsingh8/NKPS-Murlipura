-- Migration 046 — Audit-log FKs: stop cascading on exam_type delete (M15).
--
-- Deleting an exam type currently cascades into rows that exist explicitly
-- to *outlive* the exam:
--
--   * supplementary_attempts.parent_exam_type_id — student-facing record of
--     a re-test. Losing it on exam-type cleanup destroys the only proof a
--     supplementary was ever attempted.
--   * exam_schedules.exam_type_id — the published timetable. Deleting it
--     would silently revoke the schedule from teachers/students.
--
-- Both flip to SET NULL so an exam_type cleanup leaves an orphan row
-- instead of deleting it; the UI already tolerates a null exam_type via
-- the "—" placeholder pattern. (publish_events.exam_type_id was already
-- flipped in migration 041; documenting it here for completeness.)

ALTER TABLE supplementary_attempts
  ALTER COLUMN parent_exam_type_id DROP NOT NULL;
ALTER TABLE supplementary_attempts
  DROP CONSTRAINT IF EXISTS supplementary_attempts_parent_exam_type_id_fkey;
ALTER TABLE supplementary_attempts
  ADD CONSTRAINT supplementary_attempts_parent_exam_type_id_fkey
  FOREIGN KEY (parent_exam_type_id) REFERENCES exam_types(id) ON DELETE SET NULL;

ALTER TABLE exam_schedules
  ALTER COLUMN exam_type_id DROP NOT NULL;
ALTER TABLE exam_schedules
  DROP CONSTRAINT IF EXISTS exam_schedules_exam_type_id_fkey;
ALTER TABLE exam_schedules
  ADD CONSTRAINT exam_schedules_exam_type_id_fkey
  FOREIGN KEY (exam_type_id) REFERENCES exam_types(id) ON DELETE SET NULL;
