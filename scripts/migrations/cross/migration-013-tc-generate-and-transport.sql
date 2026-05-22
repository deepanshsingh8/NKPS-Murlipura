-- Migration 013: Generate Transfer Certificates from student records +
-- per-student transport opt-in for fee calculation.

-- 1. Link transfer_certificates to the source student and capture the TC payload
ALTER TABLE transfer_certificates
  ADD COLUMN IF NOT EXISTS student_id uuid REFERENCES students(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS tc_number text,
  ADD COLUMN IF NOT EXISTS issue_date date,
  ADD COLUMN IF NOT EXISTS last_attended_date date,
  ADD COLUMN IF NOT EXISTS reason_for_leaving text,
  ADD COLUMN IF NOT EXISTS conduct text,
  ADD COLUMN IF NOT EXISTS class_last_attended text,
  ADD COLUMN IF NOT EXISTS remarks text,
  ADD COLUMN IF NOT EXISTS is_generated boolean NOT NULL DEFAULT false;

CREATE UNIQUE INDEX IF NOT EXISTS idx_tc_tc_number ON transfer_certificates(tc_number) WHERE tc_number IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_tc_student_id ON transfer_certificates(student_id);

-- 2. Transport opt-in belongs to the student's enrollment
ALTER TABLE student_enrollments
  ADD COLUMN IF NOT EXISTS has_transport boolean NOT NULL DEFAULT false;

-- 3. Allow authenticated admins to UPDATE transfer_certificates (needed when the
--    generator re-runs and refreshes the stored PDF URL / issue date).
DROP POLICY IF EXISTS "Admins can update TCs" ON transfer_certificates;
CREATE POLICY "Admins can update TCs"
  ON transfer_certificates FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid() AND profiles.role = 'admin'
    )
  );
