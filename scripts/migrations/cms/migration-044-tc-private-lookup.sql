-- Migration 044: Lock down public TC access. The current schema lets the
-- anon key SELECT every row in `transfer_certificates`, leaking student
-- names + admission numbers, and serves a signed-URL download to anyone
-- with a TC UUID. After this migration the public flow is gated by an
-- (admission_no, date_of_birth) match performed server-side.
--
-- Idempotent. Re-running is safe.

-- ─────────────────────────────────────────────────────────────────────────
-- 1. Snapshot student DOB onto the TC row
-- ─────────────────────────────────────────────────────────────────────────
-- We deliberately denormalize DOB onto the TC instead of joining through
-- `student_id` because:
--   - student_id is ON DELETE SET NULL — losing a student would silently
--     orphan the TC and break public lookup forever.
--   - Future admin policy may purge inactive student rows.
-- TCs are sealed historical documents; their identity should not depend on
-- a row that the school may legitimately delete.

ALTER TABLE transfer_certificates
  ADD COLUMN IF NOT EXISTS student_dob date;

-- Backfill from the linked student where available. Rows without a linked
-- student, or whose linked student has no DOB on file, stay NULL and are
-- intentionally unfindable from the public lookup endpoint until an admin
-- re-links them. Admin views are unaffected.
UPDATE transfer_certificates tc
SET student_dob = s.date_of_birth
FROM students s
WHERE tc.student_id = s.id
  AND tc.student_dob IS NULL
  AND s.date_of_birth IS NOT NULL;

-- Composite index for the public lookup. Partial — rows with a NULL
-- student_dob are unfindable by definition, no need to index them.
CREATE INDEX IF NOT EXISTS idx_tc_admission_dob
  ON transfer_certificates(admission_no, student_dob)
  WHERE student_dob IS NOT NULL AND admission_no IS NOT NULL;

-- ─────────────────────────────────────────────────────────────────────────
-- 2. Replace public SELECT with authenticated-only SELECT
-- ─────────────────────────────────────────────────────────────────────────
-- All public reads now route through the server (service-role admin client)
-- via the lookup endpoint, which enforces an exact (admission_no, dob)
-- match before returning anything. The browser anon key has no SELECT
-- access. Authenticated admins/editors keep SELECT so the admin TC page
-- can list rows via the standard browser client.

DROP POLICY IF EXISTS "Public can view transfer certificates" ON transfer_certificates;

CREATE POLICY "Authenticated users can view transfer certificates"
  ON transfer_certificates FOR SELECT
  USING (auth.role() = 'authenticated');
