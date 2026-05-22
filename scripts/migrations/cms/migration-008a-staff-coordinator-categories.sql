-- Migration 008: Add coordinator categories to staff_members
-- Drops the old CHECK constraint and replaces it with an expanded one

ALTER TABLE staff_members DROP CONSTRAINT IF EXISTS staff_members_category_check;

ALTER TABLE staff_members ADD CONSTRAINT staff_members_category_check
  CHECK (category IN (
    'management', 'admin', 'pgt', 'tgt', 'prt',
    'motherTeachers', 'prePrimaryCoordinator', 'primaryCoordinator',
    'middleCoordinator', 'seniorCoordinator',
    'additionalStaff', 'busDriver', 'peon'
  ));
