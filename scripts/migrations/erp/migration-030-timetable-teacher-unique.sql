-- Migration 030: prevent timetable double-booking of a teacher.
--
-- Existing schema enforces UNIQUE(class_id, day_of_week, period_number) so a
-- single class can't have two simultaneous periods. But a teacher can still
-- be assigned to two different classes at the same time slot — the UI
-- allowed it silently.
--
-- This migration adds a partial UNIQUE index on
--   (teacher_id, day_of_week, period_number)
-- — partial because teacher_id is nullable (e.g. for "free period" rows).
--
-- Pre-flight: returns offending pairs if any exist. Resolve them before
-- applying:
--
-- SELECT teacher_id, day_of_week, period_number, COUNT(*)
-- FROM timetable_periods
-- WHERE teacher_id IS NOT NULL
-- GROUP BY 1,2,3 HAVING COUNT(*) > 1;

CREATE UNIQUE INDEX IF NOT EXISTS idx_timetable_teacher_slot_unique
  ON timetable_periods (teacher_id, day_of_week, period_number)
  WHERE teacher_id IS NOT NULL;
