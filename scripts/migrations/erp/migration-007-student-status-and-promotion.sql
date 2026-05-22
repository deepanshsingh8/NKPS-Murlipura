-- Migration 007: Student enrollment status & alumni fields
-- Run this in Supabase SQL Editor

-- =============================================================
-- 1. Add status column to student_enrollments
-- =============================================================
ALTER TABLE student_enrollments
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active';

-- Add check constraint (drop first if it exists to allow re-running)
ALTER TABLE student_enrollments DROP CONSTRAINT IF EXISTS student_enrollments_status_check;
ALTER TABLE student_enrollments ADD CONSTRAINT student_enrollments_status_check
  CHECK (status IN ('active', 'passed', 'failed', 'terminated', 'exited'));

CREATE INDEX IF NOT EXISTS idx_student_enrollments_status ON student_enrollments(status);

-- =============================================================
-- 2. Add alumni fields to students table
-- =============================================================
ALTER TABLE students
  ADD COLUMN IF NOT EXISTS is_alumni boolean DEFAULT false;

ALTER TABLE students
  ADD COLUMN IF NOT EXISTS alumni_passing_year text;

ALTER TABLE students
  ADD COLUMN IF NOT EXISTS alumni_academic_year_id uuid REFERENCES academic_years(id);
