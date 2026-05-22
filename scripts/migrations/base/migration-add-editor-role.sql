-- Migration: Add 'editor' role to profiles table
-- Run this in Supabase SQL Editor on existing databases

-- Drop the existing constraint and recreate with 'editor' included
ALTER TABLE profiles DROP CONSTRAINT IF EXISTS profiles_role_check;
ALTER TABLE profiles ADD CONSTRAINT profiles_role_check
  CHECK (role IN ('admin', 'editor', 'teacher', 'student'));
