-- =============================================================
-- Migration 071: timetable teacher clash = TIME OVERLAP, not period number
-- =============================================================
-- Classes run on STAGGERED schedules — "period 3" in one class is a different
-- wall-clock time than "period 3" in another. The old uniqueness index
-- (teacher_id, day_of_week, period_number) modelled clashes by period number,
-- which BOTH rejected valid non-overlapping staggered periods that happen to
-- share a number AND allowed genuine double-bookings across different numbers.
--
-- This replaces it with a true time-overlap exclusion constraint.
--
-- ⚠️  PRE-CHECK BEFORE APPLYING: this constraint will FAIL to create if the
--     live data already contains overlapping periods for a teacher (the old
--     index permitted them). Run this first and resolve any rows it returns:
--
--       SELECT a.teacher_id, a.day_of_week,
--              a.id AS period_a, a.start_time AS a_start, a.end_time AS a_end,
--              b.id AS period_b, b.start_time AS b_start, b.end_time AS b_end
--       FROM timetable_periods a
--       JOIN timetable_periods b
--         ON a.teacher_id = b.teacher_id
--        AND a.day_of_week = b.day_of_week
--        AND a.id < b.id
--        AND a.teacher_id IS NOT NULL
--        AND a.is_break IS NOT TRUE AND b.is_break IS NOT TRUE
--        AND a.start_time < b.end_time
--        AND a.end_time > b.start_time;
--
-- SAFE TO RE-RUN.
-- =============================================================

BEGIN;

-- btree_gist lets a GiST exclusion constraint mix equality (teacher_id,
-- day_of_week) with the range-overlap operator.
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- Drop the period_number-based teacher uniqueness — wrong model.
DROP INDEX IF EXISTS idx_timetable_teacher_slot_unique;

-- A teacher cannot occupy two periods whose wall-clock ranges overlap on the
-- same weekday. Postgres has no built-in range type for `time`, so times are
-- anchored to a fixed date and compared as tsrange. Breaks / free (teacher_id
-- NULL) rows are exempt.
-- NOTE: the predicate also requires start_time < end_time. tsrange() errors on
-- a lower bound greater than the upper bound, so any degenerate row
-- (end_time <= start_time, i.e. bad legacy data) must be excluded from the
-- index — otherwise CREATE CONSTRAINT fails with "range lower bound must be
-- less than or equal to range upper bound". Such rows are invalid and can't
-- meaningfully overlap anything; the app validates end > start on writes.
-- Find any offenders with:
--   SELECT id, class_id, day_of_week, period_number, start_time, end_time
--   FROM timetable_periods WHERE end_time <= start_time;
ALTER TABLE timetable_periods
  DROP CONSTRAINT IF EXISTS timetable_teacher_no_overlap;
ALTER TABLE timetable_periods
  ADD CONSTRAINT timetable_teacher_no_overlap
  EXCLUDE USING gist (
    teacher_id WITH =,
    day_of_week WITH =,
    tsrange('2000-01-01'::date + start_time, '2000-01-01'::date + end_time) WITH &&
  ) WHERE (teacher_id IS NOT NULL AND is_break IS NOT TRUE AND start_time < end_time);

COMMIT;
