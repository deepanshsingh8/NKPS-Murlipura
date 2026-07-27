-- Migration 083: Enforce one teacher row per staff member
--
-- Why: promoteStaffToTeacher() (apps/erp/src/lib/staff-teacher-sync.ts) guards
-- against duplicates with a non-atomic select-then-insert, and teachers has no
-- uniqueness on staff_member_id. Two concurrent provisioning actions for the
-- same staff member (auto-create-on-add + "Convert to teacher" click) can both
-- see no existing row and both insert, yielding two teachers rows for one staff
-- member — the person then appears twice in every teacher picker.
--
-- Fix: a partial UNIQUE index on teachers(staff_member_id) WHERE staff_member_id
-- IS NOT NULL. Combined with the 23505-retry now handled in promoteStaffToTeacher,
-- provisioning becomes idempotent under concurrency.
--
-- Safety: this migration will NOT create the index (and will NOT fail) if
-- duplicate rows already exist — it raises a NOTICE listing the offending
-- staff_member_ids instead. Deduplicating existing teachers rows is intentionally
-- left manual because those rows may be referenced by timetable_periods,
-- classes.class_teacher_id, teacher_subjects, etc., and consolidating them
-- requires repointing those FKs deliberately. Once any duplicates are resolved,
-- re-run this migration to create the index.

DO $$
DECLARE
  dup_ids text;
BEGIN
  SELECT string_agg(staff_member_id::text, ', ')
    INTO dup_ids
  FROM (
    SELECT staff_member_id
    FROM teachers
    WHERE staff_member_id IS NOT NULL
    GROUP BY staff_member_id
    HAVING count(*) > 1
  ) d;

  IF dup_ids IS NOT NULL THEN
    RAISE NOTICE 'Skipping unique index: duplicate teachers rows exist for staff_member_id(s): %. Resolve these first, then re-run migration 083.', dup_ids;
  ELSE
    CREATE UNIQUE INDEX IF NOT EXISTS idx_teachers_staff_member_id_unique
      ON teachers(staff_member_id)
      WHERE staff_member_id IS NOT NULL;
    RAISE NOTICE 'Created partial unique index idx_teachers_staff_member_id_unique.';
  END IF;
END $$;
