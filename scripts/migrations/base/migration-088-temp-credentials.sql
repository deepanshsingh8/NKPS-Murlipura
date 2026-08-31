-- Migration 088: Retrievable temporary passwords for accounts that have never
-- set their own password.
--
-- Why this exists
-- ---------------
-- Portal accounts are created with a random password that is only ever
-- delivered by the welcome email. When email delivery is not configured (or
-- fails), the account is created but nobody — not even an admin — can find out
-- what the password is, because Supabase only stores its hash. Every staff
-- account created in that window is effectively unreachable.
--
-- This table holds the temporary password for exactly that window: from the
-- moment an admin issues it until the user sets their own password. It is
-- encrypted at rest with an application-held key (AES-256-GCM, see
-- packages/shared/src/lib/temp-credentials.ts) so a database dump alone does
-- not expose it, and it is deleted automatically the instant
-- profiles.must_change_password flips to false.
--
-- This is a deliberate, bounded trade-off: a *temporary* credential the admin
-- has to be able to read back in order to hand it to the user in person is
-- stored recoverably. A user's own, chosen password is never stored here.

CREATE TABLE IF NOT EXISTS user_temp_credentials (
  user_id uuid PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
  -- AES-256-GCM envelope: "v1:<iv b64>:<tag b64>:<ciphertext b64>"
  ciphertext text NOT NULL,
  issued_by uuid REFERENCES profiles(id) ON DELETE SET NULL,
  issued_at timestamptz NOT NULL DEFAULT now(),
  last_revealed_at timestamptz,
  last_revealed_by uuid REFERENCES profiles(id) ON DELETE SET NULL,
  reveal_count integer NOT NULL DEFAULT 0
);

COMMENT ON TABLE user_temp_credentials IS
  'Encrypted one-time passwords for accounts that have not set their own password yet. Rows are deleted automatically when profiles.must_change_password becomes false.';

-- ============================================================
-- RLS — service role only.
-- ============================================================
-- No policies are defined on purpose: RLS with zero policies denies every
-- anon/authenticated read and write. Only the service-role client (used by the
-- admin-gated API route) can touch this table. Note that "Admins can read all
-- profiles" also covers role='staff', so keeping the ciphertext OFF profiles is
-- what prevents non-admin staff from reading it with the browser client.
ALTER TABLE user_temp_credentials ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_temp_credentials FORCE ROW LEVEL SECURITY;

REVOKE ALL ON user_temp_credentials FROM anon, authenticated;

-- ============================================================
-- Auto-expiry: the credential dies with the forced-change flag.
-- ============================================================
-- Enforced in the database rather than in the app so that EVERY path which
-- clears the flag (portal forced change, reset-password, an admin edit, a
-- manual SQL fix) drops the stored password too. Without this, a stale
-- password could stay revealable after the user had already replaced it.
CREATE OR REPLACE FUNCTION public.drop_temp_credential_on_password_set()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.must_change_password IS DISTINCT FROM NEW.must_change_password
     AND NEW.must_change_password IS NOT TRUE THEN
    DELETE FROM public.user_temp_credentials WHERE user_id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS drop_temp_credential_on_password_set ON profiles;
CREATE TRIGGER drop_temp_credential_on_password_set
  AFTER UPDATE OF must_change_password ON profiles
  FOR EACH ROW EXECUTE FUNCTION public.drop_temp_credential_on_password_set();

-- Safety net for rows that predate the trigger (or were written while it was
-- disabled): nothing may linger for an account that already has its own password.
DELETE FROM user_temp_credentials tc
USING profiles p
WHERE p.id = tc.user_id AND p.must_change_password IS NOT TRUE;
