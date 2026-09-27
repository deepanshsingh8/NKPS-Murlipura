-- Migration 116 — teacher lifecycle: retire a teacher instead of orphaning one.
--
-- ── The bug this exists to close ────────────────────────────────────────────
-- `staff_members` (the public staff listing) and `teachers` (the ERP entity)
-- are two rows joined by `teachers.staff_member_id … ON DELETE SET NULL`.
--
--   DELETE /api/staff  hard-deletes the staff row. Postgres nulls the link.
--                      The teacher row survives with is_active = true.
--   PATCH  /api/staff  with is_active=false hides the staff row from the Staff
--                      page (it filters is_active) but never touches the
--                      teacher row either.
--
-- Either way the teacher stays active in a table no ERP screen can edit — so
-- departed staff keep appearing in every teacher dropdown. Every one of those
-- dropdowns already filters `.eq("is_active", true)` correctly; the DATA is
-- wrong, not the query. Three teachers were reported by name; this migration
-- adds the columns and the diagnostic to find the rest.
--
-- ── Why no data change here ─────────────────────────────────────────────────
-- Retiring the existing ghosts is deliberately NOT done in SQL. `is_active`
-- also gates who can be picked for a substitution and who shows in the staff
-- roster, and a heuristic sweep would be a silent bulk edit of live records
-- with no audit trail and no way to tell a genuine departure from a teacher
-- who simply has no staff row yet. The view below surfaces the candidates;
-- an admin retires them one at a time on /people/teachers, which records a
-- date and is reversible.
--
-- SAFE TO RE-RUN.

BEGIN;

-- ─── 1. Lifecycle columns ───────────────────────────────────────────────────

ALTER TABLE teachers
  ADD COLUMN IF NOT EXISTS date_of_leaving date,
  ADD COLUMN IF NOT EXISTS leaving_reason  text;

COMMENT ON COLUMN teachers.date_of_leaving IS
  'Date the teacher left the school. Set when is_active flips to false; kept '
  'when they are reactivated so a rejoin is visible in the record.';
COMMENT ON COLUMN teachers.leaving_reason IS
  'Free-text note on why the teacher was retired (resigned, transferred, …).';

-- ─── 2. Index the dropdown query ────────────────────────────────────────────
-- Every teacher select in the app is `WHERE is_active ORDER BY full_name`.
-- Partial, because nothing lists the inactive ones in bulk except the new
-- People → Teachers page, which is admin-only and low-traffic.

CREATE INDEX IF NOT EXISTS idx_teachers_active_name
  ON teachers(full_name) WHERE is_active;

-- ─── 3. The diagnostic ──────────────────────────────────────────────────────
-- A teacher row that is still active but has no staff record AND no portal
-- login is, with high probability, someone who left and was deleted from
-- People → Staff. "High probability", not certainty: a teacher created
-- directly (bulk import, migration 081 backfill) and never linked looks
-- identical. Hence a review queue, not an auto-deactivate.

CREATE OR REPLACE VIEW public.teachers_needing_review AS
  SELECT t.id,
         t.employee_id,
         t.full_name,
         t.email,
         t.phone,
         t.date_of_joining,
         t.created_at,
         -- What retiring them would leave dangling, so the page can warn
         -- before the admin commits.
         (SELECT count(*) FROM public.timetable_periods tp WHERE tp.teacher_id = t.id)
           AS timetable_period_count,
         (SELECT count(*) FROM public.class_subjects cs   WHERE cs.teacher_id = t.id)
           AS class_subject_count,
         (SELECT count(*) FROM public.classes c    WHERE c.class_teacher_id = t.id)
           AS class_teacher_count
  FROM public.teachers t
  WHERE t.is_active
    AND t.staff_member_id IS NULL
    AND NOT EXISTS (
      SELECT 1 FROM public.profiles p WHERE p.teacher_id = t.id
    );

COMMENT ON VIEW public.teachers_needing_review IS
  'Active teacher records with no linked staff_members row and no portal '
  'profile — the shape left behind when a staff member is deleted from '
  'People → Staff (teachers.staff_member_id is ON DELETE SET NULL). Review '
  'queue for /people/teachers; retiring is an explicit admin action, never '
  'automatic.';

COMMIT;
