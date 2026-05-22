-- Migration 038: Per-class scoping for non-scholastic sub-subjects.
--
-- A sub-subject with NO rows in this join table is treated as global
-- (available to every class). Adding one or more rows scopes it to those
-- specific classes. This default-global semantic preserves backwards
-- compatibility for the existing sub-subject taxonomy without requiring
-- a data backfill.
--
-- Resolver convention (mirrored in src/app/api/erp/non-scholastic/...):
--   classes_for(sub_subject) =
--     IF EXISTS (SELECT 1 FROM non_scholastic_sub_subject_classes nsc WHERE nsc.sub_subject_id = ss.id)
--       THEN [class_ids from join rows]
--       ELSE [all classes]
--
-- ON DELETE CASCADE on both FKs so deleting either side cleans up links
-- automatically (the join table is purely a scoping artifact).

CREATE TABLE IF NOT EXISTS non_scholastic_sub_subject_classes (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  sub_subject_id uuid NOT NULL
    REFERENCES non_scholastic_sub_subjects(id) ON DELETE CASCADE,
  class_id uuid NOT NULL
    REFERENCES classes(id) ON DELETE CASCADE,
  created_at timestamptz DEFAULT now(),
  CONSTRAINT non_scholastic_sub_subject_classes_unique
    UNIQUE (sub_subject_id, class_id)
);

CREATE INDEX IF NOT EXISTS idx_non_scholastic_sub_subject_classes_sub
  ON non_scholastic_sub_subject_classes(sub_subject_id);
CREATE INDEX IF NOT EXISTS idx_non_scholastic_sub_subject_classes_class
  ON non_scholastic_sub_subject_classes(class_id);

ALTER TABLE non_scholastic_sub_subject_classes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated can read non_scholastic_sub_subject_classes"
  ON non_scholastic_sub_subject_classes;
CREATE POLICY "Authenticated can read non_scholastic_sub_subject_classes"
  ON non_scholastic_sub_subject_classes FOR SELECT
  USING (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "Admins can manage non_scholastic_sub_subject_classes"
  ON non_scholastic_sub_subject_classes;
CREATE POLICY "Admins can manage non_scholastic_sub_subject_classes"
  ON non_scholastic_sub_subject_classes FOR ALL
  USING (
    EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role = 'admin')
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role = 'admin')
  );
