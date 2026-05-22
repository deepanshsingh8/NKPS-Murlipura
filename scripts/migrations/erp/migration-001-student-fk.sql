-- =============================================================
-- Migration 001: Switch student-related FKs from profiles(id) to students(id)
-- =============================================================
-- CONTEXT: The admin students page inserts into the `students` table,
-- but student_enrollments, attendance, results, and fee_payments all
-- reference profiles(id). This migration unifies them on students(id).
--
-- SAFETY: These tables should be empty (the features never worked due
-- to this FK mismatch). Verify before running in production.
-- =============================================================

-- Step 1: Add student_id column to profiles for student portal linking
-- (students who log in have a profiles row from auth; this links it to their students record)
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS student_id uuid REFERENCES students(id) ON DELETE SET NULL;

-- Step 2: Switch student_enrollments.student_id FK from profiles(id) to students(id)
ALTER TABLE student_enrollments
  DROP CONSTRAINT IF EXISTS student_enrollments_student_id_fkey;

ALTER TABLE student_enrollments
  ADD CONSTRAINT student_enrollments_student_id_fkey
  FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE;

-- Step 3: Switch attendance.student_id FK from profiles(id) to students(id)
ALTER TABLE attendance
  DROP CONSTRAINT IF EXISTS attendance_student_id_fkey;

ALTER TABLE attendance
  ADD CONSTRAINT attendance_student_id_fkey
  FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE;

-- Step 4: Switch results.student_id FK from profiles(id) to students(id)
ALTER TABLE results
  DROP CONSTRAINT IF EXISTS results_student_id_fkey;

ALTER TABLE results
  ADD CONSTRAINT results_student_id_fkey
  FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE;

-- Step 5: Switch fee_payments.student_id FK from profiles(id) to students(id)
ALTER TABLE fee_payments
  DROP CONSTRAINT IF EXISTS fee_payments_student_id_fkey;

ALTER TABLE fee_payments
  ADD CONSTRAINT fee_payments_student_id_fkey
  FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE;

-- Step 6: Update RLS policies on students table to allow teachers
-- who have class_subjects assignments (not just class_teacher_id)
-- The existing policy only checks class_teacher_id, but teachers
-- assigned via class_subjects also need read access.

-- Drop and recreate the teacher policy to include both paths
DROP POLICY IF EXISTS "Teachers can read students in their classes" ON students;

CREATE POLICY "Teachers can read students in their classes"
  ON students FOR SELECT
  USING (
    public.get_user_role() = 'teacher'
    AND id IN (
      SELECT se.student_id FROM student_enrollments se
      WHERE se.class_id IN (
        -- Classes where teacher is class_teacher
        SELECT c.id FROM classes c WHERE c.class_teacher_id = auth.uid()
        UNION
        -- Classes where teacher has subject assignments
        SELECT cs.class_id FROM class_subjects cs WHERE cs.teacher_id = auth.uid()
      )
    )
  );
