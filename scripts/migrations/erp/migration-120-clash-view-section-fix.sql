-- Migration 120 — a section-less class must not vanish from the clash view.
--
-- migration-119 built timetable_teacher_clashes with
--
--     ca.name || '-' || ca.section AS class_a
--
-- and `classes.section` is nullable. In SQL, 'VII' || '-' || NULL is NULL, so
-- any class without a section reports its label as blank — on the one screen
-- an admin opens to find out WHICH classes a teacher is double-booked across.
-- The rest of the codebase has always written this as
-- `${name}${section ? "-" + section : ""}`; this brings the view in line.
--
-- View body is otherwise unchanged from 119.
--
-- SAFE TO RE-RUN.

BEGIN;

-- Migration 119 must be in first — this view reads timetable_periods.is_shared,
-- which 119 adds. Without this guard you get a bare
-- "column a.is_shared does not exist", which names the symptom and not the
-- cause. 119 is wrapped in its own transaction, so if it errored anywhere it
-- rolled back completely and left none of its columns behind.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name   = 'timetable_periods'
       AND column_name  = 'is_shared'
  ) THEN
    RAISE EXCEPTION
      'migration 120 needs migration 119 first: timetable_periods.is_shared is missing. Apply migration-119-timetable-period-groups.sql, then re-run this.';
  END IF;
END $$;

CREATE OR REPLACE VIEW public.timetable_teacher_clashes AS
  SELECT a.teacher_id,
         t.full_name        AS teacher_name,
         a.day_of_week,
         a.id               AS period_a,
         ca.name || COALESCE('-' || ca.section, '') AS class_a,
         a.start_time       AS a_start,
         a.end_time         AS a_end,
         a.is_shared        AS a_shared,
         b.id               AS period_b,
         cb.name || COALESCE('-' || cb.section, '') AS class_b,
         b.start_time       AS b_start,
         b.end_time         AS b_end,
         b.is_shared        AS b_shared
  FROM public.timetable_periods a
  JOIN public.timetable_periods b
    ON a.teacher_id = b.teacher_id
   AND a.day_of_week = b.day_of_week
   AND a.id < b.id
  LEFT JOIN public.teachers t  ON t.id  = a.teacher_id
  LEFT JOIN public.classes  ca ON ca.id = a.class_id
  LEFT JOIN public.classes  cb ON cb.id = b.class_id
  WHERE a.teacher_id IS NOT NULL
    AND a.is_break IS NOT TRUE AND b.is_break IS NOT TRUE
    AND a.start_time < b.end_time
    AND a.end_time > b.start_time;

-- CREATE OR REPLACE keeps existing grants, but restate them so a database that
-- somehow missed 119's grants still ends up correct.
REVOKE ALL ON public.timetable_teacher_clashes FROM PUBLIC, anon;
GRANT SELECT ON public.timetable_teacher_clashes TO authenticated;

COMMENT ON VIEW public.timetable_teacher_clashes IS
  'Teachers occupying two time-overlapping periods on one weekday. The DB '
  'constraint blocks these unless a row is marked is_shared, so in a healthy '
  'timetable every row here is an intentional combined activity. A row where '
  'neither side is shared is a bug. Surfaced at /timetable/clashes.';

COMMIT;
