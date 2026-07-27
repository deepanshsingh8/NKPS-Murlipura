-- Migration 082: Harden write RLS on public content tables
--
-- Why: these tables all had write (and in two cases read) policies guarded only
-- by `auth.role() = 'authenticated'`. Because the ERP, CMS and website share one
-- Supabase project, EVERY parent/student/teacher holds an 'authenticated' JWT
-- usable with the public anon key. Any of them could therefore insert/update/
-- delete these rows directly through the anon client, bypassing all CMS
-- admin/editor gating:
--   - transfer_certificates: INSERT/DELETE were authenticated-only (UPDATE was
--     already admin-scoped by migration-013, SELECT by migration-044).
--   - contact_submissions: SELECT + UPDATE were authenticated-only, leaking
--     prospective-family PII (name/email/phone/message) to any ERP user.
--   - site_media / section_cards / staff_members / gallery_images: INSERT/
--     UPDATE/DELETE were authenticated-only (migration-060 hardened only
--     articles + gallery_images SELECT, not these write policies).
--   - disclosure_items / disclosure_documents / disclosure_board_results: the
--     legally-mandated CBSE public disclosure data was INSERT/UPDATE/DELETE-able
--     by any authenticated user.
--
-- Fix: restrict writes (and the contact_submissions read/update) to admins and
-- editors (role IN ('admin','staff')), matching migration-060's articles pattern.
-- These are all CMS editor features (gallery, transfer_certificates, contact,
-- site_media, disclosure, staff), so 'staff' is the correct editor role.
--
-- Safe to apply: all legitimate CMS writes go through the service-role admin
-- proxy (verifyAdminOrEditor), which bypasses RLS entirely — tightening these
-- policies does not affect the admin/editor experience. Public SELECT policies
-- (USING (true) / authenticated read) on section_cards/site_media/staff_members/
-- disclosure_* are intentionally left unchanged so the public website keeps
-- working; only the write policies (and contact_submissions' PII read/update)
-- are hardened here.

-- ============================================================
-- transfer_certificates: INSERT/DELETE admin/staff only
-- ============================================================
DROP POLICY IF EXISTS "Authenticated users can insert transfer certificates" ON transfer_certificates;
DROP POLICY IF EXISTS "Authenticated users can delete transfer certificates" ON transfer_certificates;

CREATE POLICY "Staff can insert transfer certificates"
  ON transfer_certificates FOR INSERT TO authenticated
  WITH CHECK (public.get_user_role() IN ('admin', 'staff'));

CREATE POLICY "Staff can delete transfer certificates"
  ON transfer_certificates FOR DELETE TO authenticated
  USING (public.get_user_role() IN ('admin', 'staff'));

-- ============================================================
-- contact_submissions: SELECT/UPDATE admin/staff only (PII)
-- ============================================================
DROP POLICY IF EXISTS "Authenticated users can view contact submissions" ON contact_submissions;
DROP POLICY IF EXISTS "Authenticated users can update contact submissions" ON contact_submissions;

CREATE POLICY "Staff can view contact submissions"
  ON contact_submissions FOR SELECT TO authenticated
  USING (public.get_user_role() IN ('admin', 'staff'));

CREATE POLICY "Staff can update contact submissions"
  ON contact_submissions FOR UPDATE TO authenticated
  USING (public.get_user_role() IN ('admin', 'staff'))
  WITH CHECK (public.get_user_role() IN ('admin', 'staff'));

-- ============================================================
-- site_media: INSERT/UPDATE admin/staff only
-- ============================================================
DROP POLICY IF EXISTS "Authenticated users can insert site_media" ON site_media;
DROP POLICY IF EXISTS "Authenticated users can update site_media" ON site_media;

CREATE POLICY "Staff can insert site_media"
  ON site_media FOR INSERT TO authenticated
  WITH CHECK (public.get_user_role() IN ('admin', 'staff'));

CREATE POLICY "Staff can update site_media"
  ON site_media FOR UPDATE TO authenticated
  USING (public.get_user_role() IN ('admin', 'staff'))
  WITH CHECK (public.get_user_role() IN ('admin', 'staff'));

-- ============================================================
-- section_cards: INSERT/UPDATE/DELETE admin/staff only
-- ============================================================
DROP POLICY IF EXISTS "Authenticated users can insert section_cards" ON section_cards;
DROP POLICY IF EXISTS "Authenticated users can update section_cards" ON section_cards;
DROP POLICY IF EXISTS "Authenticated users can delete section_cards" ON section_cards;

CREATE POLICY "Staff can insert section_cards"
  ON section_cards FOR INSERT TO authenticated
  WITH CHECK (public.get_user_role() IN ('admin', 'staff'));

CREATE POLICY "Staff can update section_cards"
  ON section_cards FOR UPDATE TO authenticated
  USING (public.get_user_role() IN ('admin', 'staff'))
  WITH CHECK (public.get_user_role() IN ('admin', 'staff'));

CREATE POLICY "Staff can delete section_cards"
  ON section_cards FOR DELETE TO authenticated
  USING (public.get_user_role() IN ('admin', 'staff'));

-- ============================================================
-- staff_members: INSERT/UPDATE/DELETE admin/staff only
-- ============================================================
DROP POLICY IF EXISTS "Authenticated users can insert staff members" ON staff_members;
DROP POLICY IF EXISTS "Authenticated users can update staff members" ON staff_members;
DROP POLICY IF EXISTS "Authenticated users can delete staff members" ON staff_members;

CREATE POLICY "Staff can insert staff members"
  ON staff_members FOR INSERT TO authenticated
  WITH CHECK (public.get_user_role() IN ('admin', 'staff'));

CREATE POLICY "Staff can update staff members"
  ON staff_members FOR UPDATE TO authenticated
  USING (public.get_user_role() IN ('admin', 'staff'))
  WITH CHECK (public.get_user_role() IN ('admin', 'staff'));

CREATE POLICY "Staff can delete staff members"
  ON staff_members FOR DELETE TO authenticated
  USING (public.get_user_role() IN ('admin', 'staff'));

-- ============================================================
-- gallery_images: INSERT/UPDATE/DELETE admin/staff only
-- ============================================================
DROP POLICY IF EXISTS "Authenticated users can insert gallery images" ON gallery_images;
DROP POLICY IF EXISTS "Authenticated users can update gallery images" ON gallery_images;
DROP POLICY IF EXISTS "Authenticated users can delete gallery images" ON gallery_images;

CREATE POLICY "Staff can insert gallery images"
  ON gallery_images FOR INSERT TO authenticated
  WITH CHECK (public.get_user_role() IN ('admin', 'staff'));

CREATE POLICY "Staff can update gallery images"
  ON gallery_images FOR UPDATE TO authenticated
  USING (public.get_user_role() IN ('admin', 'staff'))
  WITH CHECK (public.get_user_role() IN ('admin', 'staff'));

CREATE POLICY "Staff can delete gallery images"
  ON gallery_images FOR DELETE TO authenticated
  USING (public.get_user_role() IN ('admin', 'staff'));

-- ============================================================
-- disclosure_items / disclosure_documents / disclosure_board_results:
-- INSERT/UPDATE/DELETE admin/staff only (CBSE mandatory disclosure)
-- ============================================================
DROP POLICY IF EXISTS "Authenticated users can insert disclosure_items" ON disclosure_items;
DROP POLICY IF EXISTS "Authenticated users can update disclosure_items" ON disclosure_items;
DROP POLICY IF EXISTS "Authenticated users can delete disclosure_items" ON disclosure_items;

CREATE POLICY "Staff can insert disclosure_items"
  ON disclosure_items FOR INSERT TO authenticated
  WITH CHECK (public.get_user_role() IN ('admin', 'staff'));

CREATE POLICY "Staff can update disclosure_items"
  ON disclosure_items FOR UPDATE TO authenticated
  USING (public.get_user_role() IN ('admin', 'staff'))
  WITH CHECK (public.get_user_role() IN ('admin', 'staff'));

CREATE POLICY "Staff can delete disclosure_items"
  ON disclosure_items FOR DELETE TO authenticated
  USING (public.get_user_role() IN ('admin', 'staff'));

DROP POLICY IF EXISTS "Authenticated users can insert disclosure_documents" ON disclosure_documents;
DROP POLICY IF EXISTS "Authenticated users can update disclosure_documents" ON disclosure_documents;
DROP POLICY IF EXISTS "Authenticated users can delete disclosure_documents" ON disclosure_documents;

CREATE POLICY "Staff can insert disclosure_documents"
  ON disclosure_documents FOR INSERT TO authenticated
  WITH CHECK (public.get_user_role() IN ('admin', 'staff'));

CREATE POLICY "Staff can update disclosure_documents"
  ON disclosure_documents FOR UPDATE TO authenticated
  USING (public.get_user_role() IN ('admin', 'staff'))
  WITH CHECK (public.get_user_role() IN ('admin', 'staff'));

CREATE POLICY "Staff can delete disclosure_documents"
  ON disclosure_documents FOR DELETE TO authenticated
  USING (public.get_user_role() IN ('admin', 'staff'));

DROP POLICY IF EXISTS "Authenticated users can insert disclosure_board_results" ON disclosure_board_results;
DROP POLICY IF EXISTS "Authenticated users can update disclosure_board_results" ON disclosure_board_results;
DROP POLICY IF EXISTS "Authenticated users can delete disclosure_board_results" ON disclosure_board_results;

CREATE POLICY "Staff can insert disclosure_board_results"
  ON disclosure_board_results FOR INSERT TO authenticated
  WITH CHECK (public.get_user_role() IN ('admin', 'staff'));

CREATE POLICY "Staff can update disclosure_board_results"
  ON disclosure_board_results FOR UPDATE TO authenticated
  USING (public.get_user_role() IN ('admin', 'staff'))
  WITH CHECK (public.get_user_role() IN ('admin', 'staff'));

CREATE POLICY "Staff can delete disclosure_board_results"
  ON disclosure_board_results FOR DELETE TO authenticated
  USING (public.get_user_role() IN ('admin', 'staff'));
