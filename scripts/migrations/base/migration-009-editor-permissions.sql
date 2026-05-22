-- Migration 009: Per-editor feature permissions
-- Purpose: Let admins grant/revoke individual admin features for each editor user.
-- Presence of a row in editor_permissions = granted. Absence = denied.
-- Admins bypass this table entirely (they always have full access).

-- 1. Table
CREATE TABLE IF NOT EXISTS editor_permissions (
  editor_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  feature_key text NOT NULL,
  granted_by uuid REFERENCES profiles(id) ON DELETE SET NULL,
  granted_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (editor_id, feature_key)
);

CREATE INDEX IF NOT EXISTS idx_editor_permissions_editor ON editor_permissions(editor_id);

-- 2. RLS — service role bypasses, but lock down direct client access.
ALTER TABLE editor_permissions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can read editor permissions"
  ON editor_permissions FOR SELECT
  USING (public.get_user_role() = 'admin');

CREATE POLICY "Editors can read their own permissions"
  ON editor_permissions FOR SELECT
  USING (editor_id = auth.uid());

CREATE POLICY "Admins can insert editor permissions"
  ON editor_permissions FOR INSERT
  WITH CHECK (public.get_user_role() = 'admin');

CREATE POLICY "Admins can delete editor permissions"
  ON editor_permissions FOR DELETE
  USING (public.get_user_role() = 'admin');

-- 3. Backfill: every existing editor gets the same features the hardcoded
-- allowlist used to give them, so no one loses access on deploy.
INSERT INTO editor_permissions (editor_id, feature_key)
SELECT p.id, k.feature_key
FROM profiles p
CROSS JOIN (VALUES
  ('gallery'),
  ('transfer_certificates'),
  ('site_media'),
  ('disclosure'),
  ('staff'),
  ('calendar')
) AS k(feature_key)
WHERE p.role = 'editor'
ON CONFLICT (editor_id, feature_key) DO NOTHING;
