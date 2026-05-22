-- Migration 023: Non-Scholastic assessments.
-- Per-student grade for each non-scholastic sub-subject in a given exam.
-- Pairs with the Phase 0.5 masters (non_scholastic_subjects /
-- non_scholastic_sub_subjects). Grade is a label picked from the sub-subject's
-- grade_scale bands — we store the label text rather than an FK so historical
-- records survive future band edits.
--
-- Publishing mirrors results.is_published — students/parents only see
-- assessments once a teacher/admin has flagged them published.

CREATE TABLE IF NOT EXISTS non_scholastic_assessments (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  student_id uuid NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  class_id uuid NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  exam_type_id uuid NOT NULL REFERENCES exam_types(id) ON DELETE CASCADE,
  sub_subject_id uuid NOT NULL REFERENCES non_scholastic_sub_subjects(id) ON DELETE CASCADE,
  grade_label text NOT NULL,
  remarks text,
  entered_by uuid NOT NULL REFERENCES profiles(id),
  is_published boolean NOT NULL DEFAULT false,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  CONSTRAINT non_scholastic_assessments_unique
    UNIQUE (student_id, exam_type_id, sub_subject_id)
);

CREATE INDEX IF NOT EXISTS idx_nsa_student ON non_scholastic_assessments(student_id);
CREATE INDEX IF NOT EXISTS idx_nsa_exam ON non_scholastic_assessments(exam_type_id);
CREATE INDEX IF NOT EXISTS idx_nsa_class_exam ON non_scholastic_assessments(class_id, exam_type_id);
CREATE INDEX IF NOT EXISTS idx_nsa_sub_subject ON non_scholastic_assessments(sub_subject_id);

ALTER TABLE non_scholastic_assessments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins full access to non_scholastic_assessments"
  ON non_scholastic_assessments;
CREATE POLICY "Admins full access to non_scholastic_assessments"
  ON non_scholastic_assessments FOR ALL
  USING (public.get_user_role() = 'admin');

DROP POLICY IF EXISTS "Teachers can read assessments for their classes"
  ON non_scholastic_assessments;
CREATE POLICY "Teachers can read assessments for their classes"
  ON non_scholastic_assessments FOR SELECT
  USING (
    public.get_user_role() = 'teacher'
    AND class_id IN (SELECT public.get_my_class_ids())
  );

DROP POLICY IF EXISTS "Teachers can insert assessments for their classes"
  ON non_scholastic_assessments;
CREATE POLICY "Teachers can insert assessments for their classes"
  ON non_scholastic_assessments FOR INSERT
  WITH CHECK (
    public.get_user_role() = 'teacher'
    AND class_id IN (SELECT public.get_my_class_ids())
  );

DROP POLICY IF EXISTS "Teachers can update assessments for their classes"
  ON non_scholastic_assessments;
CREATE POLICY "Teachers can update assessments for their classes"
  ON non_scholastic_assessments FOR UPDATE
  USING (
    public.get_user_role() = 'teacher'
    AND class_id IN (SELECT public.get_my_class_ids())
  );

DROP POLICY IF EXISTS "Students can read own published assessments"
  ON non_scholastic_assessments;
CREATE POLICY "Students can read own published assessments"
  ON non_scholastic_assessments FOR SELECT
  USING (
    student_id = public.get_my_student_id()
    AND is_published = true
  );

DROP POLICY IF EXISTS "Parents can read children published assessments"
  ON non_scholastic_assessments;
CREATE POLICY "Parents can read children published assessments"
  ON non_scholastic_assessments FOR SELECT
  USING (
    student_id IN (SELECT public.get_my_children_ids())
    AND is_published = true
  );
