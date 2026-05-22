-- Migration 015: Grade Master.
-- Admin defines named grade scales (A+/A/B+ cutoffs) globally or per class.
-- One scale per scope may be flagged is_default; a class without an override
-- row falls back to its scope's default scale.

-- 1. Scales: library of named grade schemes.
CREATE TABLE IF NOT EXISTS grade_scales (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  name text NOT NULL,
  scope text NOT NULL CHECK (scope IN ('scholastic', 'non_scholastic')),
  is_default boolean NOT NULL DEFAULT false,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- At most one default per scope.
CREATE UNIQUE INDEX IF NOT EXISTS idx_grade_scales_one_default_per_scope
  ON grade_scales(scope)
  WHERE is_default = true;

-- 2. Bands: cutoff ranges per scale.
CREATE TABLE IF NOT EXISTS grade_bands (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  grade_scale_id uuid NOT NULL REFERENCES grade_scales(id) ON DELETE CASCADE,
  label text NOT NULL,
  min_pct numeric(5,2) NOT NULL CHECK (min_pct >= 0 AND min_pct <= 100),
  max_pct numeric(5,2) NOT NULL CHECK (max_pct >= 0 AND max_pct <= 100),
  remark text,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  CONSTRAINT grade_bands_pct_range CHECK (min_pct <= max_pct)
);

CREATE INDEX IF NOT EXISTS idx_grade_bands_scale ON grade_bands(grade_scale_id);

-- 3. Per-class override. Absence of a row = class uses the scope's default scale.
--    ON DELETE RESTRICT on grade_scale_id so we don't silently orphan a class.
CREATE TABLE IF NOT EXISTS class_grade_scales (
  class_id uuid PRIMARY KEY REFERENCES classes(id) ON DELETE CASCADE,
  grade_scale_id uuid NOT NULL REFERENCES grade_scales(id) ON DELETE RESTRICT,
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_class_grade_scales_scale ON class_grade_scales(grade_scale_id);

-- 4. Seed the default scholastic scale matching the current hardcoded behavior
--    (so nothing changes for existing reports until an admin edits it).
--    Wrapped in a "no default exists" guard so the migration is safe to re-run.
INSERT INTO grade_scales (name, scope, is_default)
SELECT 'Default Scale', 'scholastic', true
WHERE NOT EXISTS (
  SELECT 1 FROM grade_scales WHERE scope = 'scholastic' AND is_default = true
);

INSERT INTO grade_bands (grade_scale_id, label, min_pct, max_pct, sort_order)
SELECT s.id, b.label, b.min_pct, b.max_pct, b.sort_order
FROM grade_scales s
CROSS JOIN (VALUES
  -- Bands stored with integer thresholds. The runtime resolver
  -- (`computeGrade` in src/lib/grading.ts) sorts bands by min_pct DESC and
  -- picks the first whose `min_pct ≤ pct`, so the upper bound is informational
  -- and the .99-style boundary trick is no longer needed.
  ('A+', 90.00, 100.00, 1),
  ('A',  80.00,  90.00, 2),
  ('B+', 70.00,  80.00, 3),
  ('B',  60.00,  70.00, 4),
  ('C',  50.00,  60.00, 5),
  ('D',  40.00,  50.00, 6),
  ('F',   0.00,  40.00, 7)
) AS b(label, min_pct, max_pct, sort_order)
WHERE s.scope = 'scholastic'
  AND s.is_default = true
  AND NOT EXISTS (
    SELECT 1 FROM grade_bands gb WHERE gb.grade_scale_id = s.id
  );

-- 5. RLS: admins read/write; editors with the grade_master feature key
--    can read; authenticated roles can read (needed by teacher + student views
--    to compute/display grades consistently with what the admin set up).
ALTER TABLE grade_scales ENABLE ROW LEVEL SECURITY;
ALTER TABLE grade_bands ENABLE ROW LEVEL SECURITY;
ALTER TABLE class_grade_scales ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated can read grade_scales" ON grade_scales;
CREATE POLICY "Authenticated can read grade_scales"
  ON grade_scales FOR SELECT
  USING (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "Admins can manage grade_scales" ON grade_scales;
CREATE POLICY "Admins can manage grade_scales"
  ON grade_scales FOR ALL
  USING (
    EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role = 'admin')
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role = 'admin')
  );

DROP POLICY IF EXISTS "Authenticated can read grade_bands" ON grade_bands;
CREATE POLICY "Authenticated can read grade_bands"
  ON grade_bands FOR SELECT
  USING (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "Admins can manage grade_bands" ON grade_bands;
CREATE POLICY "Admins can manage grade_bands"
  ON grade_bands FOR ALL
  USING (
    EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role = 'admin')
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role = 'admin')
  );

DROP POLICY IF EXISTS "Authenticated can read class_grade_scales" ON class_grade_scales;
CREATE POLICY "Authenticated can read class_grade_scales"
  ON class_grade_scales FOR SELECT
  USING (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "Admins can manage class_grade_scales" ON class_grade_scales;
CREATE POLICY "Admins can manage class_grade_scales"
  ON class_grade_scales FOR ALL
  USING (
    EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role = 'admin')
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role = 'admin')
  );
