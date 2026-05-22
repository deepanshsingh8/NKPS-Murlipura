-- Migration 017: PDF template configs.
-- School branding (logo, name, address, affiliation) and footer content
-- (disclaimer, signature labels) are moved from hardcoded constants into
-- admin-editable rows. Each template has its own config row keyed by
-- template_key ('report_card', 'admit_card', 'white_sheet', etc.).
-- If no row exists for a template_key, callers fall back to the hardcoded
-- SCHOOL constants so nothing breaks on partial setup.

CREATE TABLE IF NOT EXISTS pdf_header_configs (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  template_key text NOT NULL UNIQUE,
  school_name text NOT NULL,
  address_line text NOT NULL,
  affiliation text,
  affiliation_number text,
  logo_url text,
  motto text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS pdf_footer_configs (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  template_key text NOT NULL UNIQUE,
  disclaimer_text text,
  show_signatures boolean NOT NULL DEFAULT true,
  signature_labels jsonb NOT NULL DEFAULT '["Class Teacher","Principal"]'::jsonb,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Seed the report_card template with the exact values the PDF currently uses,
-- so the first post-migration render is byte-identical. Admin can edit these
-- from the Header/Footer admin page; changes apply on the next PDF render.
INSERT INTO pdf_header_configs (
  template_key, school_name, address_line, affiliation, affiliation_number, logo_url
)
VALUES (
  'report_card',
  'NK Public School',
  'Grand Sikar Road, Rajawas, Jaipur – 302013',
  'CBSE',
  '1730406',
  '/images/logo.png'
)
ON CONFLICT (template_key) DO NOTHING;

INSERT INTO pdf_footer_configs (
  template_key, disclaimer_text, show_signatures, signature_labels
)
VALUES (
  'report_card',
  'This is a computer-generated document.',
  true,
  '["Class Teacher","Principal"]'::jsonb
)
ON CONFLICT (template_key) DO NOTHING;

ALTER TABLE pdf_header_configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE pdf_footer_configs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated can read pdf_header_configs" ON pdf_header_configs;
CREATE POLICY "Authenticated can read pdf_header_configs"
  ON pdf_header_configs FOR SELECT
  USING (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "Admins can manage pdf_header_configs" ON pdf_header_configs;
CREATE POLICY "Admins can manage pdf_header_configs"
  ON pdf_header_configs FOR ALL
  USING (
    EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role = 'admin')
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role = 'admin')
  );

DROP POLICY IF EXISTS "Authenticated can read pdf_footer_configs" ON pdf_footer_configs;
CREATE POLICY "Authenticated can read pdf_footer_configs"
  ON pdf_footer_configs FOR SELECT
  USING (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "Admins can manage pdf_footer_configs" ON pdf_footer_configs;
CREATE POLICY "Admins can manage pdf_footer_configs"
  ON pdf_footer_configs FOR ALL
  USING (
    EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role = 'admin')
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role = 'admin')
  );
