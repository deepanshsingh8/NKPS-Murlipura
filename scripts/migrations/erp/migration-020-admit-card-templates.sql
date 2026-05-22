-- Migration 020: Admit Card templates (reusable PDF layouts).
-- Admin creates named templates with toggles for which student fields appear
-- and which signature slots print. One template is flagged `is_default`; the
-- generation flow preselects it when admin hasn't picked one.
-- Also seeds an `admit_card` row into pdf_header_configs / pdf_footer_configs
-- so the admit card can use the same branding infrastructure as report cards.

CREATE TABLE IF NOT EXISTS admit_card_templates (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  name text NOT NULL UNIQUE,
  is_default boolean NOT NULL DEFAULT false,

  -- Layout
  orientation text NOT NULL DEFAULT 'portrait'
    CHECK (orientation IN ('portrait', 'landscape')),
  background_image_url text,

  -- Field toggles (flat columns for easier querying vs a JSONB blob)
  show_photo boolean NOT NULL DEFAULT true,
  show_admission_no boolean NOT NULL DEFAULT true,
  show_roll_no boolean NOT NULL DEFAULT true,
  show_class_section boolean NOT NULL DEFAULT true,
  show_father_name boolean NOT NULL DEFAULT true,
  show_mother_name boolean NOT NULL DEFAULT false,
  show_dob boolean NOT NULL DEFAULT true,
  show_phone boolean NOT NULL DEFAULT false,
  show_address boolean NOT NULL DEFAULT false,
  show_schedule boolean NOT NULL DEFAULT true,
  show_instructions boolean NOT NULL DEFAULT true,

  -- Instruction block (rendered only if show_instructions = true)
  instructions_text text,

  -- Signature slots: array of labels, e.g. ["Principal", "Exam Controller"]
  signature_labels jsonb NOT NULL DEFAULT '["Principal","Exam Controller"]'::jsonb,

  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Exactly one default template at a time.
CREATE UNIQUE INDEX IF NOT EXISTS idx_admit_card_templates_one_default
  ON admit_card_templates(is_default)
  WHERE is_default = true;

-- Seed a sensible default template so the generation flow works out of the box.
INSERT INTO admit_card_templates (
  name, is_default,
  show_photo, show_admission_no, show_roll_no, show_class_section,
  show_father_name, show_mother_name, show_dob,
  show_phone, show_address,
  show_schedule, show_instructions,
  instructions_text, signature_labels
)
VALUES (
  'Standard Admit Card', true,
  true, true, true, true,
  true, false, true,
  false, false,
  true, true,
  E'1. Bring this admit card to every exam. Entry without it is not permitted.\n2. Report to the exam hall 15 minutes before the start time.\n3. Electronic devices, including mobile phones, are strictly prohibited.\n4. Follow the instructions of the invigilator at all times.',
  '["Principal","Exam Controller"]'::jsonb
)
ON CONFLICT (name) DO NOTHING;

-- Reuse the pdf_header_configs / pdf_footer_configs infrastructure from
-- migration 017 for admit card branding. Seeded with the same school values
-- as the report card so the first post-migration render is consistent.
INSERT INTO pdf_header_configs (
  template_key, school_name, address_line, affiliation, affiliation_number, logo_url
)
SELECT
  'admit_card',
  (SELECT school_name FROM pdf_header_configs WHERE template_key = 'report_card' LIMIT 1),
  (SELECT address_line FROM pdf_header_configs WHERE template_key = 'report_card' LIMIT 1),
  (SELECT affiliation FROM pdf_header_configs WHERE template_key = 'report_card' LIMIT 1),
  (SELECT affiliation_number FROM pdf_header_configs WHERE template_key = 'report_card' LIMIT 1),
  (SELECT logo_url FROM pdf_header_configs WHERE template_key = 'report_card' LIMIT 1)
WHERE EXISTS (SELECT 1 FROM pdf_header_configs WHERE template_key = 'report_card')
ON CONFLICT (template_key) DO NOTHING;

INSERT INTO pdf_footer_configs (
  template_key, disclaimer_text, show_signatures, signature_labels
)
VALUES (
  'admit_card',
  'This is a computer-generated admit card.',
  true,
  '["Principal","Exam Controller"]'::jsonb
)
ON CONFLICT (template_key) DO NOTHING;

ALTER TABLE admit_card_templates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated can read admit_card_templates" ON admit_card_templates;
CREATE POLICY "Authenticated can read admit_card_templates"
  ON admit_card_templates FOR SELECT
  USING (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "Admins can manage admit_card_templates" ON admit_card_templates;
CREATE POLICY "Admins can manage admit_card_templates"
  ON admit_card_templates FOR ALL
  USING (
    EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role = 'admin')
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role = 'admin')
  );
