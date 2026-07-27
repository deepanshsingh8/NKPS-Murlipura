-- Migration 062 — backfill profiles.teacher_id for teacher accounts that were
-- linked to the wrong id by the staff "Create Users" (bulk-create) flow.
--
-- Bug: /api/portal/bulk-create wrote `profiles.teacher_id = staff_members.id`,
-- but the column is a FK to `teachers.id`. The mismatched write violated the FK
-- and silently failed, leaving teacher_id NULL. Affected teachers could not see
-- their assigned classes/students or mark attendance because every teacher-facing
-- query resolves the user via `SELECT teacher_id FROM profiles WHERE id = auth.uid()`.
--
-- The code path is fixed going forward (it now resolves the real teachers.id via
-- promoteStaffToTeacher). This repairs accounts already created. There is no stored
-- staff_member_id on the profile to recover from, so we re-link by email — the
-- teachers row mirrors the staff member's email, which equals the login email.
--
-- profiles.teacher_id is a privileged column locked by the guard_profile_privileged_cols
-- trigger (migration 061). That guard only exempts the service-role client and admins
-- resolved via a JWT (auth.uid()). Run from the Supabase SQL editor — the postgres
-- superuser with NO JWT — neither exemption matches, so the trigger blocks this
-- backfill with "Not allowed to modify privileged profile columns". This is a
-- sanctioned DBA repair, so we disable that ONE trigger for the two UPDATEs and
-- re-enable it, all inside a transaction so a failure rolls the disable back too.
-- The FK and every other trigger stay active; the guard's runtime protection for
-- regular authenticated users is unchanged.

BEGIN;

ALTER TABLE public.profiles DISABLE TRIGGER guard_profile_privileged_cols;

-- 1) Direct email match: profile email == teachers.email.
UPDATE public.profiles p
SET teacher_id = t.id
FROM public.teachers t
WHERE p.role = 'teacher'
  AND p.teacher_id IS NULL
  AND p.email IS NOT NULL
  AND t.email IS NOT NULL
  AND lower(p.email) = lower(t.email);

-- 2) Fallback via the staff_members link, for teachers whose teachers.email is
--    blank but whose staff_members row carries the email used to log in.
UPDATE public.profiles p
SET teacher_id = t.id
FROM public.teachers t
JOIN public.staff_members s ON s.id = t.staff_member_id
WHERE p.role = 'teacher'
  AND p.teacher_id IS NULL
  AND p.email IS NOT NULL
  AND s.email IS NOT NULL
  AND lower(p.email) = lower(s.email);

ALTER TABLE public.profiles ENABLE TRIGGER guard_profile_privileged_cols;

COMMIT;

-- Surface any teacher accounts still unlinked after both passes (e.g. no teachers
-- row was ever created for them). These need a manual "Convert to teacher" + relink.
DO $$
DECLARE
  orphan_count integer;
BEGIN
  SELECT count(*) INTO orphan_count
  FROM public.profiles
  WHERE role = 'teacher' AND teacher_id IS NULL;
  IF orphan_count > 0 THEN
    RAISE NOTICE 'migration-062: % teacher profile(s) still have a NULL teacher_id; convert their staff member to a teacher and recreate/relink.', orphan_count;
  END IF;
END $$;
