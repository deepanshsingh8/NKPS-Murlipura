-- Migration 016: Exam type extensions + per-class exam config.
--
-- 1. `kind` classifies exams (term_exam / class_test / practical). Class
--    tests roll into the final result alongside term exams per their
--    weightage (admin-configured below), so they live in exam_types rather
--    than a parallel module.
--
-- 2. `upper_header` is the per-exam banner text (e.g. "ANNUAL EXAMINATION
--    2025-26") that will show above the school name on admit cards and
--    report cards in later phases.
--
-- 3. `class_exam_configs` is the per-class override layer for exam config:
--    each (class, exam) row may set weightage, override max_marks, mark
--    the exam as not applicable to the class, or reorder. Absence of a row
--    = exam applies with the defaults from exam_types. This supports the
--    admin's "flexibility to have the marks distribution according to the
--    exams admin adds...and according to the class as well" requirement.

ALTER TABLE exam_types
  ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'term_exam',
  ADD COLUMN IF NOT EXISTS upper_header text;

ALTER TABLE exam_types
  DROP CONSTRAINT IF EXISTS exam_types_kind_check;
ALTER TABLE exam_types
  ADD CONSTRAINT exam_types_kind_check
  CHECK (kind IN ('term_exam', 'class_test', 'practical'));

CREATE TABLE IF NOT EXISTS class_exam_configs (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  class_id uuid NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  exam_type_id uuid NOT NULL REFERENCES exam_types(id) ON DELETE CASCADE,
  is_applicable boolean NOT NULL DEFAULT true,
  weightage numeric(5,2),
  max_marks_override numeric(5,2),
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  CONSTRAINT class_exam_configs_unique UNIQUE (class_id, exam_type_id),
  CONSTRAINT class_exam_configs_weightage_range
    CHECK (weightage IS NULL OR (weightage >= 0 AND weightage <= 100)),
  CONSTRAINT class_exam_configs_max_marks_positive
    CHECK (max_marks_override IS NULL OR max_marks_override > 0)
);

CREATE INDEX IF NOT EXISTS idx_class_exam_configs_class ON class_exam_configs(class_id);
CREATE INDEX IF NOT EXISTS idx_class_exam_configs_exam ON class_exam_configs(exam_type_id);

ALTER TABLE class_exam_configs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated can read class_exam_configs" ON class_exam_configs;
CREATE POLICY "Authenticated can read class_exam_configs"
  ON class_exam_configs FOR SELECT
  USING (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "Admins can manage class_exam_configs" ON class_exam_configs;
CREATE POLICY "Admins can manage class_exam_configs"
  ON class_exam_configs FOR ALL
  USING (
    EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role = 'admin')
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role = 'admin')
  );
