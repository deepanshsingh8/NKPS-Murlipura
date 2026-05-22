-- Migration 005: Add must_change_password flag to profiles
-- Forces first-time login users to set their own password

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS must_change_password boolean DEFAULT false;
