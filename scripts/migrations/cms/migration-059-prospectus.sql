-- Migration 059: Prospectus documents.
--
-- CMS-managed list of downloadable prospectus PDFs (e.g. "Prospectus 2026-27",
-- stream brochures). Public, open downloads — mirrors disclosure_documents,
-- but rows are freely created/deleted rather than pre-seeded fixed slots.
--
-- Files live in the public "prospectus" Storage bucket (created manually in
-- the Supabase Dashboard — see supabase-schema.sql section 8).
--
-- Idempotent.

begin;

CREATE TABLE IF NOT EXISTS prospectus_documents (
  id uuid DEFAULT uuid_generate_v4() PRIMARY KEY,
  title text NOT NULL,
  file_url text NOT NULL,
  file_name text,
  sort_order integer DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE prospectus_documents ENABLE ROW LEVEL SECURITY;

-- Public read (also served via service role on the website); writes are
-- performed by service-role API routes, which bypass RLS. The authenticated
-- policies let the CMS browser client list rows.
DROP POLICY IF EXISTS "Public can read prospectus_documents" ON prospectus_documents;
CREATE POLICY "Public can read prospectus_documents"
  ON prospectus_documents FOR SELECT USING (true);

DROP POLICY IF EXISTS "Authenticated users can insert prospectus_documents" ON prospectus_documents;
CREATE POLICY "Authenticated users can insert prospectus_documents"
  ON prospectus_documents FOR INSERT WITH CHECK (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "Authenticated users can update prospectus_documents" ON prospectus_documents;
CREATE POLICY "Authenticated users can update prospectus_documents"
  ON prospectus_documents FOR UPDATE USING (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "Authenticated users can delete prospectus_documents" ON prospectus_documents;
CREATE POLICY "Authenticated users can delete prospectus_documents"
  ON prospectus_documents FOR DELETE USING (auth.role() = 'authenticated');

commit;
