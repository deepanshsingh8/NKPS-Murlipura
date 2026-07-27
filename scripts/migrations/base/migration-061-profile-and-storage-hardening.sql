-- Migration 061: Profile privilege-escalation + signup + storage hardening
--
-- Three independent security fixes from the May-2026 security audit. All are
-- safe to apply on a live DB and do not change the admin/editor experience
-- (those paths use the service-role client, which bypasses RLS and is
-- explicitly allowed by the guards below).
--
-- ── C1 (Critical): profiles self-update could escalate to admin ──────────────
--   The "Users can update own profile" policy had only a USING clause (no
--   WITH CHECK, no column restriction), so any authenticated parent/student
--   could `UPDATE profiles SET role='admin'` on their own row via the browser
--   anon client and instantly own the platform. We add a BEFORE UPDATE trigger
--   that rejects changes to privileged columns (role, is_active,
--   must_change_password, teacher_id, student_id, parent_id) unless the caller
--   is an admin or the service role. We also REVOKE blanket column UPDATE and
--   GRANT back only the columns a user may legitimately self-edit.
--
-- ── H1 (High): handle_new_user trusted a client-asserted role ────────────────
--   The signup trigger copied `raw_user_meta_data->>'role'` verbatim. If public
--   signup is ever enabled in Supabase Auth, an attacker could self-register as
--   admin. We hardcode 'student' on insert; the admin creation paths
--   (auth.admin.createUser → registrations/approve, /api/users, bulk-create)
--   set the real role server-side afterward via the service-role client.
--
-- ── H2 (High): storage buckets ──────────────────────────────────────────────
--   The transfer-certificates bucket is flipped to private MANUALLY in Supabase
--   Studio (deliberate operational choice); the signed-URL TC routes work either
--   way, so this migration does not automate that flip.
--   Writes to content buckets are restricted to the service role (all uploads
--   already go through admin-gated signed-URL minting or the avatar API, which
--   use the service-role client; signed-URL uploads are authorized by the token,
--   not by the uploader's RLS, so this does not break them).
--
--   NOTE: the previous bucket policies were created in the Supabase Dashboard
--   ("Allow authenticated users") and are NOT in this file, so they cannot be
--   dropped by name here. After running this migration you MUST delete the old
--   permissive INSERT/UPDATE/DELETE policies on storage.objects for the buckets
--   gallery, transfer-certificates, site-media, staff-photos, avatars,
--   disclosure-documents in Dashboard → Storage → Policies. Otherwise RLS stays
--   permissive (policies are OR-combined).

-- ============================================================
-- C1 — Lock privileged profile columns
-- ============================================================
CREATE OR REPLACE FUNCTION public.guard_profile_privileged_cols()
RETURNS TRIGGER AS $$
BEGIN
  -- Server-side API (service-role client) and admins may change anything.
  IF auth.role() = 'service_role' OR public.get_user_role() = 'admin' THEN
    RETURN NEW;
  END IF;

  -- A regular authenticated user (parent/student/teacher/staff editing their
  -- own row) must not touch role/access columns.
  IF NEW.role               IS DISTINCT FROM OLD.role
     OR NEW.is_active             IS DISTINCT FROM OLD.is_active
     OR NEW.must_change_password  IS DISTINCT FROM OLD.must_change_password
     OR NEW.teacher_id            IS DISTINCT FROM OLD.teacher_id
     OR NEW.student_id            IS DISTINCT FROM OLD.student_id
     OR NEW.parent_id             IS DISTINCT FROM OLD.parent_id THEN
    RAISE EXCEPTION 'Not allowed to modify privileged profile columns';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS guard_profile_privileged_cols ON profiles;
CREATE TRIGGER guard_profile_privileged_cols
  BEFORE UPDATE ON profiles
  FOR EACH ROW EXECUTE FUNCTION public.guard_profile_privileged_cols();

-- Defense in depth: column-level privileges. Even if the trigger were dropped,
-- the authenticated role cannot write privileged columns. Service role and
-- admin write via the service-role key, which is not subject to these grants.
REVOKE UPDATE ON public.profiles FROM authenticated;
GRANT UPDATE (full_name, phone, avatar_url) ON public.profiles TO authenticated;

-- ============================================================
-- H1 — Do not trust client-supplied role at signup
-- ============================================================
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name, role)
  VALUES (
    new.id, new.email,
    COALESCE(new.raw_user_meta_data->>'full_name', new.email),
    -- Role is NEVER taken from client metadata. Admin-creation paths set the
    -- real role afterward via the service-role client.
    'student'
  );
  RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- H2 — Storage: private TC bucket + service-role-only writes
-- ============================================================
-- NOTE: the transfer-certificates bucket is flipped to private MANUALLY in
-- Supabase Studio (deliberate operational choice — see project memory). The TC
-- lookup/download routes issue short-lived signed URLs that work regardless of
-- the bucket's public flag, so this migration intentionally does NOT automate it.

-- Restrict writes on user-content buckets to the service role. Signed-URL
-- uploads (gallery/site-media/staff-photos/disclosure) and the avatar API all
-- run through the service-role client, so this does not affect them.
DROP POLICY IF EXISTS "Service role manages content buckets" ON storage.objects;
CREATE POLICY "Service role manages content buckets"
  ON storage.objects FOR ALL
  TO service_role
  USING (
    bucket_id IN ('gallery','transfer-certificates','site-media',
                  'staff-photos','disclosure-documents','avatars')
  )
  WITH CHECK (
    bucket_id IN ('gallery','transfer-certificates','site-media',
                  'staff-photos','disclosure-documents','avatars')
  );

-- A user may overwrite ONLY their own avatar object (avatars/<uid>.<ext>),
-- matching apps/erp/.../api/portal/avatar/route.ts which writes that path via
-- the service-role client. This policy lets a future direct-anon-client avatar
-- upload remain self-scoped without granting cross-user write.
DROP POLICY IF EXISTS "Users manage own avatar object" ON storage.objects;
CREATE POLICY "Users manage own avatar object"
  ON storage.objects FOR ALL
  TO authenticated
  USING (
    bucket_id = 'avatars'
    AND (storage.foldername(name))[1] IS NOT DISTINCT FROM auth.uid()::text
  )
  WITH CHECK (
    bucket_id = 'avatars'
    AND (storage.foldername(name))[1] IS NOT DISTINCT FROM auth.uid()::text
  );

-- Public read for public buckets (everything except transfer-certificates).
DROP POLICY IF EXISTS "Public read of public content buckets" ON storage.objects;
CREATE POLICY "Public read of public content buckets"
  ON storage.objects FOR SELECT
  USING (
    bucket_id IN ('gallery','site-media','staff-photos','avatars',
                  'disclosure-documents')
  );

-- Enforce allowed MIME types + size caps at the STORAGE layer. The signed-URL
-- upload flow lets the client set the object's content-type, so an attacker
-- could otherwise store HTML/SVG under an image/pdf extension and get stored
-- XSS. allowed_mime_types makes Supabase reject the upload regardless of the
-- client. (Closes the content-type-spoofing + SVG class; bounds quota abuse.)
UPDATE storage.buckets
  SET allowed_mime_types = ARRAY['image/jpeg','image/png','image/webp'],
      file_size_limit = 5242880      -- 5 MB
  WHERE id IN ('gallery','site-media','avatars');
UPDATE storage.buckets
  SET allowed_mime_types = ARRAY['image/jpeg','image/png'],
      file_size_limit = 2097152      -- 2 MB
  WHERE id = 'staff-photos';
UPDATE storage.buckets
  SET allowed_mime_types = ARRAY['application/pdf'],
      file_size_limit = 10485760     -- 10 MB
  WHERE id IN ('transfer-certificates','disclosure-documents');
