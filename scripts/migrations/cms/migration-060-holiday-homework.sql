-- Migration 060: Holiday homework documents.
--
-- CMS-managed, per-class, per-session downloadable homework PDFs. Each row is
-- tagged with a class (Nursery–XII), a break session (Summer / Winter) and an
-- academic year. The public page groups downloads by class. Public, open
-- downloads — mirrors disclosure_documents, rows freely created/deleted.
--
-- Files live in the public "holiday-homework" Storage bucket (created manually
-- in the Supabase Dashboard — see supabase-schema.sql section 8).
--
-- Idempotent.

begin;

CREATE TABLE IF NOT EXISTS holiday_homework (
  id uuid DEFAULT uuid_generate_v4() PRIMARY KEY,
  title text NOT NULL,
  class_grade text NOT NULL,
  session text NOT NULL,
  academic_year text NOT NULL,
  file_url text NOT NULL,
  file_name text,
  sort_order integer DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE holiday_homework ENABLE ROW LEVEL SECURITY;

-- Public read (also served via service role on the website); writes are
-- performed by service-role API routes, which bypass RLS. The authenticated
-- policies let the CMS browser client list rows.
DROP POLICY IF EXISTS "Public can read holiday_homework" ON holiday_homework;
CREATE POLICY "Public can read holiday_homework"
  ON holiday_homework FOR SELECT USING (true);

DROP POLICY IF EXISTS "Authenticated users can insert holiday_homework" ON holiday_homework;
CREATE POLICY "Authenticated users can insert holiday_homework"
  ON holiday_homework FOR INSERT WITH CHECK (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "Authenticated users can update holiday_homework" ON holiday_homework;
CREATE POLICY "Authenticated users can update holiday_homework"
  ON holiday_homework FOR UPDATE USING (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "Authenticated users can delete holiday_homework" ON holiday_homework;
CREATE POLICY "Authenticated users can delete holiday_homework"
  ON holiday_homework FOR DELETE USING (auth.role() = 'authenticated');

commit;
