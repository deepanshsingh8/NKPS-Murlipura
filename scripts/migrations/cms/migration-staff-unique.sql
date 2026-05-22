-- Add unique constraint on staff_members (name + category)
-- Prevents duplicate staff entries in the same category
-- Run this in Supabase SQL Editor

-- First, check for and remove any existing duplicates (keep the oldest)
DELETE FROM staff_members
WHERE id NOT IN (
  SELECT DISTINCT ON (name, category) id
  FROM staff_members
  ORDER BY name, category, created_at ASC
);

-- Add the unique constraint
ALTER TABLE staff_members
ADD CONSTRAINT staff_members_name_category_unique UNIQUE (name, category);
