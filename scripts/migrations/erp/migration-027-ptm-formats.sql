-- Migration 027: PTM Format templates (Phase 6 Chunk C).
--
-- Admin-configurable template for the printable handout given to parents
-- BEFORE a parent-teacher meeting. Separate from `ptm_notes` (which stores
-- post-meeting records) — this is the pre-meeting artifact with:
--   - student header (name, roll, admission no, father/mother, photo)
--   - subject-wise performance snapshot from `results` for a chosen exam
--   - blank space for teacher's face-to-face remarks
--   - parent signature line
--
-- Model mirrors `admit_card_templates` — a thin row of boolean toggles +
-- text knobs, one row per template, with an `is_default` flag so a
-- one-click "generate for class X using the default template" flow works
-- without forcing the admin to pick a template every time. Multiple
-- templates coexist (e.g. one for primary and one for senior) and the
-- default can be toggled via a partial unique index.

CREATE TABLE IF NOT EXISTS ptm_formats (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  name text NOT NULL UNIQUE,
  is_default boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,

  intro_text text,
  closing_text text,

  show_student_details boolean NOT NULL DEFAULT true,
  show_photo boolean NOT NULL DEFAULT false,
  show_father_name boolean NOT NULL DEFAULT true,
  show_mother_name boolean NOT NULL DEFAULT true,
  show_performance_snapshot boolean NOT NULL DEFAULT true,
  show_teacher_remarks_section boolean NOT NULL DEFAULT true,
  teacher_remarks_lines integer NOT NULL DEFAULT 6,
  show_parent_signature boolean NOT NULL DEFAULT true,

  signature_labels jsonb NOT NULL DEFAULT '["Class Teacher","Parent Signature"]'::jsonb,

  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),

  CONSTRAINT ptm_formats_remarks_lines_positive
    CHECK (teacher_remarks_lines >= 0 AND teacher_remarks_lines <= 20)
);

-- Only one default row can be active at a time.
CREATE UNIQUE INDEX IF NOT EXISTS ptm_formats_single_default
  ON ptm_formats(is_default)
  WHERE is_default = true;

CREATE OR REPLACE FUNCTION public.ptm_formats_touch_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS ptm_formats_set_updated_at ON ptm_formats;
CREATE TRIGGER ptm_formats_set_updated_at
  BEFORE UPDATE ON ptm_formats
  FOR EACH ROW EXECUTE FUNCTION public.ptm_formats_touch_updated_at();

ALTER TABLE ptm_formats ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated read ptm_formats" ON ptm_formats;
CREATE POLICY "Authenticated read ptm_formats"
  ON ptm_formats FOR SELECT
  USING (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "Admins manage ptm_formats" ON ptm_formats;
CREATE POLICY "Admins manage ptm_formats"
  ON ptm_formats FOR ALL
  USING (
    EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role = 'admin')
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role = 'admin')
  );

-- Seed one default template so the "Download" flow works out of the box
-- before an admin ever opens the Settings page.
INSERT INTO ptm_formats (name, is_default, intro_text, closing_text)
VALUES (
  'Default PTM Format',
  true,
  'Dear Parent, this handout summarises your child''s recent performance. Please bring it to the upcoming parent-teacher meeting for reference and signature.',
  'Thank you for your continued support. We look forward to discussing your child''s progress.'
)
ON CONFLICT (name) DO NOTHING;
