-- Migration 018: Non-Scholastic masters.
-- Subjects (e.g. "Discipline", "Art Education", "Health & Physical Education")
-- and their sub-subjects (e.g. under Discipline: "Punctuality", "Behaviour",
-- "Attendance"). Each sub-subject can optionally bind to a specific non-
-- scholastic grade_scale; if unset, the scope's default scale is used.
-- No subject rows are seeded — CBSE/ICSE/school-specific taxonomies vary,
-- admin sets them up from the admin page.

CREATE TABLE IF NOT EXISTS non_scholastic_subjects (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  name text NOT NULL UNIQUE,
  sort_order integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS non_scholastic_sub_subjects (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  parent_subject_id uuid NOT NULL REFERENCES non_scholastic_subjects(id) ON DELETE CASCADE,
  name text NOT NULL,
  grade_scale_id uuid REFERENCES grade_scales(id) ON DELETE SET NULL,
  sort_order integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  CONSTRAINT non_scholastic_sub_subjects_parent_name_unique UNIQUE (parent_subject_id, name)
);

CREATE INDEX IF NOT EXISTS idx_non_scholastic_sub_subjects_parent
  ON non_scholastic_sub_subjects(parent_subject_id);
CREATE INDEX IF NOT EXISTS idx_non_scholastic_sub_subjects_scale
  ON non_scholastic_sub_subjects(grade_scale_id);

-- Seed a default non-scholastic grade scale so admin doesn't have to create
-- one before entering sub-subjects. Uses a CBSE-style 4-grade rubric where
-- percentages are metadata only — the entry UI in Phase 2 lets teachers pick
-- a label directly rather than enter a score.
INSERT INTO grade_scales (name, scope, is_default)
VALUES ('Default Co-Scholastic Scale', 'non_scholastic', true)
ON CONFLICT DO NOTHING;

INSERT INTO grade_bands (grade_scale_id, label, min_pct, max_pct, remark, sort_order)
SELECT s.id, label, min_pct, max_pct, remark, sort_order
FROM grade_scales s
CROSS JOIN (VALUES
  ('A', 75.00, 100.00, 'Excellent',            1),
  ('B', 50.00,  74.99, 'Good',                 2),
  ('C', 25.00,  49.99, 'Satisfactory',         3),
  ('D',  0.00,  24.99, 'Needs Improvement',    4)
) AS bands(label, min_pct, max_pct, remark, sort_order)
WHERE s.scope = 'non_scholastic'
  AND s.is_default = true
  AND NOT EXISTS (
    SELECT 1 FROM grade_bands gb WHERE gb.grade_scale_id = s.id
  );

ALTER TABLE non_scholastic_subjects ENABLE ROW LEVEL SECURITY;
ALTER TABLE non_scholastic_sub_subjects ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated can read non_scholastic_subjects" ON non_scholastic_subjects;
CREATE POLICY "Authenticated can read non_scholastic_subjects"
  ON non_scholastic_subjects FOR SELECT
  USING (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "Admins can manage non_scholastic_subjects" ON non_scholastic_subjects;
CREATE POLICY "Admins can manage non_scholastic_subjects"
  ON non_scholastic_subjects FOR ALL
  USING (
    EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role = 'admin')
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role = 'admin')
  );

DROP POLICY IF EXISTS "Authenticated can read non_scholastic_sub_subjects" ON non_scholastic_sub_subjects;
CREATE POLICY "Authenticated can read non_scholastic_sub_subjects"
  ON non_scholastic_sub_subjects FOR SELECT
  USING (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "Admins can manage non_scholastic_sub_subjects" ON non_scholastic_sub_subjects;
CREATE POLICY "Admins can manage non_scholastic_sub_subjects"
  ON non_scholastic_sub_subjects FOR ALL
  USING (
    EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role = 'admin')
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role = 'admin')
  );
