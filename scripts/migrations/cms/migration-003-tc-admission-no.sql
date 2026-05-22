-- Migration 003: Add admission_no to transfer_certificates for searchability
-- This allows TC lookups by admission number in addition to student name

ALTER TABLE transfer_certificates
  ADD COLUMN IF NOT EXISTS admission_no text;

-- Create index for faster search
CREATE INDEX IF NOT EXISTS idx_tc_admission_no ON transfer_certificates(admission_no);
CREATE INDEX IF NOT EXISTS idx_tc_student_name ON transfer_certificates(student_name);
