-- Migration 022: Result Master + Advanced Settings.
--
-- Admin-configurable rules per (class, academic_year) that drive Report Card
-- generation. Covers basic rules (pass marks, pass criteria, included
-- subjects, main vs optional) and six power controls (weightage via existing
-- class_exam_configs, best-of for class tests + practicals, grace marks,
-- rounding, non-scholastic display, grade scale override).
--
-- Notes:
-- - `pass_criteria_type` has no DB CHECK by design: the resolver in
--   src/lib/final-result.ts owns the enum so new criteria types can ship
--   without a migration. `pass_criteria_config` holds type-specific params.
-- - `pass_mark_mode` lets admin choose between percentage (33%) or raw marks
--   (33/100). Per-subject override uses the master's mode.
-- - Best-of rules select the top-N exams of a kind by percentage; dropped
--   exams still appear on the report card row-by-row but do NOT contribute
--   to the final aggregate. No weight redistribution — admin tunes weights
--   in class_exam_configs if they want a constant total contribution.
-- - No result_master row for a class/year → report card falls back to the
--   legacy layout. This is the pre-Phase-3 regression guarantee.

CREATE TABLE IF NOT EXISTS result_masters (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  class_id uuid NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  academic_year_id uuid NOT NULL REFERENCES academic_years(id) ON DELETE CASCADE,

  -- Basic rules
  pass_mark_mode text NOT NULL DEFAULT 'percentage',
  pass_mark_value numeric(6,2) NOT NULL DEFAULT 33,
  pass_criteria_type text NOT NULL DEFAULT 'all_main_subjects',
  pass_criteria_config jsonb NOT NULL DEFAULT '{}'::jsonb,

  -- Display
  show_rank boolean NOT NULL DEFAULT false,
  show_extra_separately boolean NOT NULL DEFAULT true,
  include_non_scholastic boolean NOT NULL DEFAULT false,
  non_scholastic_placement text NOT NULL DEFAULT 'below',

  -- Grading override (NULL = use class_grade_scales or scope default)
  grade_scale_id uuid REFERENCES grade_scales(id) ON DELETE SET NULL,

  -- Grace marks (percentage points; applied before pass check; covers main + optional)
  grace_marks_per_subject_max numeric(5,2) NOT NULL DEFAULT 0,
  grace_marks_total_max numeric(5,2) NOT NULL DEFAULT 0,
  grace_marks_condition text NOT NULL DEFAULT 'failing_only',

  -- Rounding
  rounding_mode text NOT NULL DEFAULT 'none',
  rounding_precision integer NOT NULL DEFAULT 0,
  round_raw_marks boolean NOT NULL DEFAULT false,

  -- Best-of rules (NULL = use all exams of that kind)
  class_test_best_of integer,
  practical_best_of integer,

  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),

  CONSTRAINT result_masters_unique UNIQUE (class_id, academic_year_id),
  CONSTRAINT result_masters_pass_mark_mode_check
    CHECK (pass_mark_mode IN ('percentage', 'raw_marks')),
  CONSTRAINT result_masters_pass_mark_value_check
    CHECK (pass_mark_value >= 0),
  CONSTRAINT result_masters_non_scholastic_placement_check
    CHECK (non_scholastic_placement IN ('below', 'above', 'separate_page')),
  CONSTRAINT result_masters_grace_per_subject_range
    CHECK (grace_marks_per_subject_max >= 0 AND grace_marks_per_subject_max <= 100),
  CONSTRAINT result_masters_grace_total_range
    CHECK (grace_marks_total_max >= 0 AND grace_marks_total_max <= 100),
  CONSTRAINT result_masters_grace_condition_check
    CHECK (grace_marks_condition IN ('failing_only', 'any_subject')),
  CONSTRAINT result_masters_rounding_mode_check
    CHECK (rounding_mode IN ('none', 'half_up', 'half_down', 'ceil', 'floor')),
  CONSTRAINT result_masters_rounding_precision_check
    CHECK (rounding_precision BETWEEN 0 AND 2),
  CONSTRAINT result_masters_class_test_best_of_positive
    CHECK (class_test_best_of IS NULL OR class_test_best_of > 0),
  CONSTRAINT result_masters_practical_best_of_positive
    CHECK (practical_best_of IS NULL OR practical_best_of > 0)
);

CREATE INDEX IF NOT EXISTS idx_result_masters_class_year
  ON result_masters(class_id, academic_year_id);
CREATE INDEX IF NOT EXISTS idx_result_masters_academic_year
  ON result_masters(academic_year_id);

CREATE TABLE IF NOT EXISTS result_master_subjects (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  result_master_id uuid NOT NULL REFERENCES result_masters(id) ON DELETE CASCADE,
  subject_id uuid NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'main',
  -- Override uses master.pass_mark_mode interpretation (% or raw marks)
  pass_mark_value_override numeric(6,2),
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz DEFAULT now(),

  CONSTRAINT result_master_subjects_unique UNIQUE (result_master_id, subject_id),
  CONSTRAINT result_master_subjects_role_check
    CHECK (role IN ('main', 'optional')),
  CONSTRAINT result_master_subjects_override_nonneg
    CHECK (pass_mark_value_override IS NULL OR pass_mark_value_override >= 0)
);

CREATE INDEX IF NOT EXISTS idx_result_master_subjects_master
  ON result_master_subjects(result_master_id);
CREATE INDEX IF NOT EXISTS idx_result_master_subjects_subject
  ON result_master_subjects(subject_id);

-- RLS: authenticated read (so student/parent/teacher report-card generation
-- can resolve the rules); admin write only.
ALTER TABLE result_masters ENABLE ROW LEVEL SECURITY;
ALTER TABLE result_master_subjects ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated can read result_masters" ON result_masters;
CREATE POLICY "Authenticated can read result_masters"
  ON result_masters FOR SELECT
  USING (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "Admins can manage result_masters" ON result_masters;
CREATE POLICY "Admins can manage result_masters"
  ON result_masters FOR ALL
  USING (
    EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role = 'admin')
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role = 'admin')
  );

DROP POLICY IF EXISTS "Authenticated can read result_master_subjects" ON result_master_subjects;
CREATE POLICY "Authenticated can read result_master_subjects"
  ON result_master_subjects FOR SELECT
  USING (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "Admins can manage result_master_subjects" ON result_master_subjects;
CREATE POLICY "Admins can manage result_master_subjects"
  ON result_master_subjects FOR ALL
  USING (
    EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role = 'admin')
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role = 'admin')
  );
