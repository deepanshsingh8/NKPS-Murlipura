-- Migration 034: Document the IST timezone assumption for exam_schedules.
-- The start_time/end_time columns are `time` (without timezone). The
-- school's exams run in Asia/Kolkata, and every consumer (admit card PDFs,
-- date-fns formatters in the admin UI, ICS feeds) treats the values as
-- already-IST clock times — there is no per-row timezone offset to apply.
-- Switching the columns to `timetz` would force every read site to handle
-- a UTC offset that is constant in practice, so we keep the simpler `time`
-- column type and lock down the assumption with COMMENTs that show up in
-- pgAdmin / `\d+ exam_schedules`.

COMMENT ON COLUMN exam_schedules.start_time IS
  'Local clock time in Asia/Kolkata (IST, UTC+05:30). No timezone applied at read time — all consumers assume IST.';
COMMENT ON COLUMN exam_schedules.end_time IS
  'Local clock time in Asia/Kolkata (IST, UTC+05:30). See start_time.';
COMMENT ON COLUMN exam_schedules.exam_date IS
  'Calendar date in Asia/Kolkata. Stored as `date`, no timezone applied.';
