-- Migration 081 — backfill teachers records for existing teaching staff.
--
-- Teaching staff are now given a linked `teachers` record on add (so they're
-- assignable to classes/timetable/attendance) regardless of whether they get a
-- login. Staff added before that change only got a teacher record if they were
-- given a login (email present) or if an admin clicked "Convert to teacher".
-- This one-time backfill creates the missing records for every active teaching
-- staff member not yet linked.
--
-- Field mapping mirrors promoteStaffToTeacher() in lib/staff-teacher-sync.ts:
-- name→full_name and the shared contact/personal fields; employee_id is a
-- unique auto-generated 'TCH-BF-…' value (BF = backfill).
--
-- Idempotent: the NOT EXISTS guard skips any staff already linked to a teacher,
-- so re-running creates nothing new.

INSERT INTO teachers (
  employee_id, full_name, email, phone, date_of_birth,
  address, qualifications, photo_url, staff_member_id
)
SELECT
  'TCH-BF-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10)),
  s.name,
  s.email,
  s.phone,
  s.date_of_birth,
  s.address,
  s.qualifications,
  s.photo_url,
  s.id
FROM staff_members s
WHERE s.is_active = true
  AND s.category IN (
    'pgt', 'tgt', 'prt', 'motherTeachers',
    'prePrimaryCoordinator', 'primaryCoordinator',
    'middleCoordinator', 'seniorCoordinator'
  )
  AND NOT EXISTS (
    SELECT 1 FROM teachers t WHERE t.staff_member_id = s.id
  );
