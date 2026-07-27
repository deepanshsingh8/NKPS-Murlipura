-- Migration 060: Harden content-table RLS (articles + gallery_images)
--
-- Why: both tables had policies that any *authenticated* user could exploit.
--   - articles INSERT/UPDATE/DELETE were `TO authenticated WITH CHECK (true)`,
--     so any ERP parent/student/teacher JWT could deface or delete articles
--     directly via the anon client, bypassing CMS permission checks.
--   - gallery_images SELECT was `USING (true)`, exposing images that belong to
--     PRIVATE (is_public = false) gallery events to anyone with the public anon key.
--
-- Safe to apply: all CMS writes go through the service-role client
-- (verifyAdminOrEditor), which bypasses RLS — so tightening these policies does
-- not affect the admin/editor experience. The public website reads articles via
-- the service-role client and reads gallery_images via the anon client (standalone
-- images + public-event images only), both of which remain functional below.

-- ============================================================
-- articles: writes are admin/staff only
-- ============================================================
DROP POLICY IF EXISTS "Authenticated can insert articles" ON articles;
DROP POLICY IF EXISTS "Authenticated can update articles" ON articles;
DROP POLICY IF EXISTS "Authenticated can delete articles" ON articles;

CREATE POLICY "Staff can insert articles"
  ON articles FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin', 'staff'))
  );

CREATE POLICY "Staff can update articles"
  ON articles FOR UPDATE TO authenticated
  USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin', 'staff'))
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin', 'staff'))
  );

CREATE POLICY "Staff can delete articles"
  ON articles FOR DELETE TO authenticated
  USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin', 'staff'))
  );

-- ============================================================
-- gallery_images: public SELECT limited to non-private images
-- ============================================================
DROP POLICY IF EXISTS "Public can view gallery images" ON gallery_images;

CREATE POLICY "Public can view public gallery images"
  ON gallery_images FOR SELECT
  USING (
    -- Standalone images (not tied to any event) are general public gallery items.
    gallery_event_id IS NULL
    -- Event images are visible only when their event is public.
    OR EXISTS (
      SELECT 1 FROM gallery_events e
      WHERE e.id = gallery_images.gallery_event_id AND e.is_public = true
    )
  );
