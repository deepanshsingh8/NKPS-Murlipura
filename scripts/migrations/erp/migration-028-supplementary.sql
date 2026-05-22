-- Migration 028: Supplementary Exam workflow (Phase 8).
--
-- Schools allow students who fail one or two subjects in a main exam to
-- retest those subjects only. Pass criteria for supplementary is usually
-- "minimum X marks in original" (eligibility) and "pass in retest"
-- (qualification). Legacy platform stores these as
--   MinForSupplementary=25, SupplementarySubs=2
-- per Result Master configuration.
--
-- The retest is recorded against the *same* parent_exam_type_id (it's not
-- a new exam type — the supplementary marks substitute into the original
-- exam's slot for purposes of final-result recompute).
--
-- supplementary_pass_action controls how the substitution flows into the
-- final result:
--   - 'cap_at_pass_mark': substitute = pass_mark (most schools — discourages
--     the "save your scores" gaming pattern). Default.
--   - 'use_retest_marks': substitute = actual retest marks_obtained.

-- =============================================================
-- Result Masters: supplementary settings columns
-- =============================================================
ALTER TABLE result_masters
  ADD COLUMN IF NOT EXISTS min_for_supplementary numeric(6,2);
ALTER TABLE result_masters
  ADD COLUMN IF NOT EXISTS max_supplementary_subjects integer NOT NULL DEFAULT 2;
ALTER TABLE result_masters
  ADD COLUMN IF NOT EXISTS supplementary_pass_action text
    NOT NULL DEFAULT 'cap_at_pass_mark';

ALTER TABLE result_masters
  DROP CONSTRAINT IF EXISTS result_masters_supp_threshold_nonneg;
ALTER TABLE result_masters
  ADD CONSTRAINT result_masters_supp_threshold_nonneg
  CHECK (min_for_supplementary IS NULL OR min_for_supplementary >= 0);

ALTER TABLE result_masters
  DROP CONSTRAINT IF EXISTS result_masters_max_supp_subs_nonneg;
ALTER TABLE result_masters
  ADD CONSTRAINT result_masters_max_supp_subs_nonneg
  CHECK (max_supplementary_subjects >= 0);

ALTER TABLE result_masters
  DROP CONSTRAINT IF EXISTS result_masters_supp_pass_action_check;
ALTER TABLE result_masters
  ADD CONSTRAINT result_masters_supp_pass_action_check
  CHECK (supplementary_pass_action IN ('cap_at_pass_mark', 'use_retest_marks'));

-- =============================================================
-- supplementary_attempts
-- =============================================================
CREATE TABLE IF NOT EXISTS supplementary_attempts (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  student_id uuid NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  parent_exam_type_id uuid NOT NULL REFERENCES exam_types(id) ON DELETE CASCADE,
  subject_id uuid NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
  class_id uuid NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  retest_date date,
  marks_obtained numeric(6,2) NOT NULL,
  max_marks numeric(6,2) NOT NULL,
  passed boolean NOT NULL,
  entered_by uuid REFERENCES profiles(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),

  CONSTRAINT supplementary_attempts_unique
    UNIQUE (student_id, parent_exam_type_id, subject_id),
  CONSTRAINT supplementary_attempts_marks_range
    CHECK (marks_obtained >= 0 AND marks_obtained <= max_marks),
  CONSTRAINT supplementary_attempts_max_positive
    CHECK (max_marks > 0)
);

CREATE INDEX IF NOT EXISTS idx_supplementary_attempts_student
  ON supplementary_attempts(student_id);
CREATE INDEX IF NOT EXISTS idx_supplementary_attempts_exam_subject
  ON supplementary_attempts(parent_exam_type_id, subject_id);
CREATE INDEX IF NOT EXISTS idx_supplementary_attempts_class
  ON supplementary_attempts(class_id);

CREATE OR REPLACE FUNCTION public.supplementary_attempts_touch_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS supplementary_attempts_set_updated_at ON supplementary_attempts;
CREATE TRIGGER supplementary_attempts_set_updated_at
  BEFORE UPDATE ON supplementary_attempts
  FOR EACH ROW EXECUTE FUNCTION public.supplementary_attempts_touch_updated_at();

ALTER TABLE supplementary_attempts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins manage supplementary_attempts" ON supplementary_attempts;
CREATE POLICY "Admins manage supplementary_attempts"
  ON supplementary_attempts FOR ALL
  USING (
    EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role = 'admin')
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role = 'admin')
  );

DROP POLICY IF EXISTS "Teachers read supplementary_attempts for own classes" ON supplementary_attempts;
CREATE POLICY "Teachers read supplementary_attempts for own classes"
  ON supplementary_attempts FOR SELECT
  USING (class_id IN (SELECT public.get_my_class_ids()));

DROP POLICY IF EXISTS "Teachers write supplementary_attempts for own classes" ON supplementary_attempts;
CREATE POLICY "Teachers write supplementary_attempts for own classes"
  ON supplementary_attempts FOR INSERT
  WITH CHECK (class_id IN (SELECT public.get_my_class_ids()));

DROP POLICY IF EXISTS "Teachers update supplementary_attempts for own classes" ON supplementary_attempts;
CREATE POLICY "Teachers update supplementary_attempts for own classes"
  ON supplementary_attempts FOR UPDATE
  USING (class_id IN (SELECT public.get_my_class_ids()));

DROP POLICY IF EXISTS "Teachers delete supplementary_attempts for own classes" ON supplementary_attempts;
CREATE POLICY "Teachers delete supplementary_attempts for own classes"
  ON supplementary_attempts FOR DELETE
  USING (class_id IN (SELECT public.get_my_class_ids()));

DROP POLICY IF EXISTS "Parents read supplementary_attempts for own children" ON supplementary_attempts;
CREATE POLICY "Parents read supplementary_attempts for own children"
  ON supplementary_attempts FOR SELECT
  USING (student_id IN (SELECT public.get_my_children_ids()));
