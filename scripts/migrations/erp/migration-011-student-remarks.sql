-- Migration 011: Class teacher remarks on a student's report card per exam.
-- Distinct from results.remarks (which is per subject — e.g. "needs practice in
-- algebra"). student_remarks is the overall note the class teacher writes
-- for that term/exam, shown at the bottom of the printed report card.

CREATE TABLE IF NOT EXISTS student_remarks (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  student_id uuid NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  exam_type_id uuid NOT NULL REFERENCES exam_types(id) ON DELETE CASCADE,
  remark text NOT NULL,
  author_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE (student_id, exam_type_id)
);

CREATE INDEX IF NOT EXISTS idx_student_remarks_student ON student_remarks(student_id);
CREATE INDEX IF NOT EXISTS idx_student_remarks_exam ON student_remarks(exam_type_id);

-- RLS: students see their own, parents see their linked children's, teachers
-- and admins can read/write. Mirrors the pattern used by `results`.
ALTER TABLE student_remarks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Students read own remarks" ON student_remarks;
CREATE POLICY "Students read own remarks"
  ON student_remarks FOR SELECT
  TO authenticated
  USING (
    student_id IN (
      SELECT student_id FROM profiles WHERE id = auth.uid() AND student_id IS NOT NULL
    )
  );

DROP POLICY IF EXISTS "Parents read linked children remarks" ON student_remarks;
CREATE POLICY "Parents read linked children remarks"
  ON student_remarks FOR SELECT
  TO authenticated
  USING (
    student_id IN (
      SELECT sp.student_id
      FROM student_parents sp
      JOIN profiles p ON p.parent_id = sp.parent_id
      WHERE p.id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Teachers read all remarks" ON student_remarks;
CREATE POLICY "Teachers read all remarks"
  ON student_remarks FOR SELECT
  TO authenticated
  USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('teacher', 'admin', 'editor'))
  );

DROP POLICY IF EXISTS "Teachers upsert remarks" ON student_remarks;
CREATE POLICY "Teachers upsert remarks"
  ON student_remarks FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('teacher', 'admin'))
  );

DROP POLICY IF EXISTS "Teachers update remarks" ON student_remarks;
CREATE POLICY "Teachers update remarks"
  ON student_remarks FOR UPDATE
  TO authenticated
  USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('teacher', 'admin'))
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('teacher', 'admin'))
  );

DROP POLICY IF EXISTS "Admins delete remarks" ON student_remarks;
CREATE POLICY "Admins delete remarks"
  ON student_remarks FOR DELETE
  TO authenticated
  USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
  );
