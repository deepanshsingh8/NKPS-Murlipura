-- Migration 047: Editor as a capability, not a role
-- Drops the 'editor' role value and adds 'staff' for non-teaching admin/office personnel.
-- Editor capability is now expressed entirely through the editor_permissions table
-- and may be held by 'staff' or 'teacher' (admin always has full access).

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Drop the old CHECK constraint FIRST so the backfill UPDATE can write the
-- new 'staff' value. (The old constraint only allowed 'editor', so leaving it
-- in place causes an UPDATE-time check-constraint violation.)
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE profiles DROP CONSTRAINT IF EXISTS profiles_role_check;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Backfill: every existing 'editor' becomes 'staff'. editor_permissions
-- rows are keyed by editor_id (= profiles.id) so they survive untouched.
-- ─────────────────────────────────────────────────────────────────────────────
UPDATE profiles SET role = 'staff' WHERE role = 'editor';

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Add the new CHECK constraint with the final role enum.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE profiles ADD CONSTRAINT profiles_role_check
  CHECK (role IN ('admin', 'staff', 'teacher', 'student', 'parent'));

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. SQL helper used by RLS policies that need a feature-scoped capability
-- check (mirrors the verifyAdminOrEditor helper in app code).
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.has_editor_feature(p_feature text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.editor_permissions
    WHERE editor_id = auth.uid() AND feature_key = p_feature
  );
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. RLS policy updates — replace 'editor' role with 'staff' role.
-- Per-feature gating happens at the application layer via verifyAdminOrEditor;
-- RLS stays role-coarse so policy bodies stay fast.
-- ─────────────────────────────────────────────────────────────────────────────

-- profiles: "Admins can read all profiles" (admin staff list, etc.)
DROP POLICY IF EXISTS "Admins can read all profiles" ON profiles;
CREATE POLICY "Admins can read all profiles"
  ON profiles FOR SELECT
  USING (public.get_user_role() IN ('admin', 'staff'));

-- student_remarks: "Teachers read all remarks" (teaching + office staff)
DROP POLICY IF EXISTS "Teachers read all remarks" ON student_remarks;
CREATE POLICY "Teachers read all remarks"
  ON student_remarks FOR SELECT
  TO authenticated
  USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('teacher', 'admin', 'staff'))
  );
