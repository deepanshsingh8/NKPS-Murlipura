-- migration-078-staff-license-number.sql
--
-- Adds a driving-license number to staff records, for the school's transport
-- roster. Only bus drivers (category = 'busDriver') use it in the UI, but the
-- column lives on staff_members like every other staff particular rather than
-- on a driver-specific side table — a driver IS a staff member, and a flat
-- nullable column keeps the existing /api/staff read/write path unchanged.
--
-- NULLABLE: existing rows have no license on file, and non-driver staff never
-- get one. No format CHECK — license formats vary by state/RTO and dirty data
-- must not block a staff update (format validation lives in Zod).
-- Idempotent.

ALTER TABLE staff_members
  ADD COLUMN IF NOT EXISTS license_number text;
