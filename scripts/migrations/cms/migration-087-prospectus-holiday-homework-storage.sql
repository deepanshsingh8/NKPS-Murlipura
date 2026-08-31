-- Migration 087 — bring the prospectus and holiday-homework buckets under the
-- same storage hardening as the other CMS document buckets.
--
-- Both buckets were created by hand in the Supabase Dashboard (migrations 059
-- and 060) and were never picked up by migration 061, so they carry neither a
-- MIME allowlist nor a size cap, and they are missing from the version-
-- controlled storage.objects policies. Their upload pages accept PDFs only and
-- promise a 10 MB cap, so pin exactly that at the storage layer — the same
-- treatment disclosure-documents already gets.
--
-- Creates either bucket if it is absent, so a fresh project no longer depends
-- on someone remembering the manual Dashboard step.
--
-- Idempotent: re-running just re-asserts the same config and policies.

-- Public read (the website links these PDFs directly), 10 MB, PDF only.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES
  ('prospectus','prospectus', true, 10485760, ARRAY['application/pdf']),
  ('holiday-homework','holiday-homework', true, 10485760, ARRAY['application/pdf'])
ON CONFLICT (id) DO UPDATE
  SET public = EXCLUDED.public,
      file_size_limit = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;

-- Extend the two content-bucket policies from migration 061 to cover them.
-- Writes stay service-role only: browser uploads go through the admin-gated
-- signed-URL mint in apps/cms/src/app/api/upload-url/route.ts.
DROP POLICY IF EXISTS "Service role manages content buckets" ON storage.objects;
CREATE POLICY "Service role manages content buckets"
  ON storage.objects FOR ALL
  TO service_role
  USING (
    bucket_id IN ('gallery','transfer-certificates','site-media',
                  'staff-photos','disclosure-documents','avatars',
                  'prospectus','holiday-homework')
  )
  WITH CHECK (
    bucket_id IN ('gallery','transfer-certificates','site-media',
                  'staff-photos','disclosure-documents','avatars',
                  'prospectus','holiday-homework')
  );

DROP POLICY IF EXISTS "Public read of public content buckets" ON storage.objects;
CREATE POLICY "Public read of public content buckets"
  ON storage.objects FOR SELECT
  USING (
    bucket_id IN ('gallery','site-media','staff-photos','avatars',
                  'disclosure-documents','prospectus','holiday-homework')
  );
