-- migration-072-student-profile-udise.sql
--
-- Extends `students` to hold the school's mandated UDISE+-style student
-- template: a General Profile (21 particulars) + Enrolment Profile (12
-- particulars). All student-level template fields become flat columns here
-- (one table); class/section/stream/roll/subjects stay on the enrollment
-- tables. Existing columns are reused where they already match the template:
-- address = Present Address, category = Social Category, nationality derives
-- "Indian National? (YES/NO)", previous_school = previous school name.
--
-- Every column is NULLABLE — bulk uploads arrive partially filled, and for
-- booleans "unknown" must stay distinguishable from "NO".
--
-- Format rules for aadhar/mobiles/pincodes deliberately live in Zod, not in
-- CHECK constraints: real-world sheets are dirty, and one bad value would
-- fail an entire 100-row upsert batch. Enum-ish columns DO get CHECKs since
-- app-side normalization maps unknown values to NULL before insert.
-- Idempotent.

ALTER TABLE students
  -- ── General Profile ───────────────────────────────────────────────────
  ADD COLUMN IF NOT EXISTS name_as_per_aadhar text,
  ADD COLUMN IF NOT EXISTS jan_aadhar_number text,
  ADD COLUMN IF NOT EXISTS mother_occupation text,
  ADD COLUMN IF NOT EXISTS mother_qualification text,
  ADD COLUMN IF NOT EXISTS mother_mobile text,
  ADD COLUMN IF NOT EXISTS mother_annual_income numeric(12, 2),
  ADD COLUMN IF NOT EXISTS father_occupation text,
  ADD COLUMN IF NOT EXISTS father_qualification text,
  ADD COLUMN IF NOT EXISTS father_mobile text,
  ADD COLUMN IF NOT EXISTS father_annual_income numeric(12, 2),
  ADD COLUMN IF NOT EXISTS guardian_name text,
  ADD COLUMN IF NOT EXISTS guardian_relation text,
  ADD COLUMN IF NOT EXISTS guardian_mobile text,
  -- `address` (existing) is the Present Address; pincodes are separate so
  -- the template's "Address + Pin Code" sub-fields round-trip losslessly.
  ADD COLUMN IF NOT EXISTS present_pincode text,
  ADD COLUMN IF NOT EXISTS permanent_address text,
  ADD COLUMN IF NOT EXISTS permanent_pincode text,
  ADD COLUMN IF NOT EXISTS mother_tongue text,
  -- Distinct from `religion`: the template's Minority Group is a fixed
  -- administrative list (incl. 'none'), not free-text religion.
  ADD COLUMN IF NOT EXISTS minority_group text,
  ADD COLUMN IF NOT EXISTS is_bpl boolean,
  ADD COLUMN IF NOT EXISTS is_ews boolean,
  ADD COLUMN IF NOT EXISTS is_cwsn boolean,
  -- Free text "type (code)" — UDISE impairment codes vary by cycle.
  ADD COLUMN IF NOT EXISTS cwsn_impairment_type text,
  ADD COLUMN IF NOT EXISTS height_cm numeric(5, 1),
  ADD COLUMN IF NOT EXISTS weight_kg numeric(5, 1),
  -- ── Enrolment Profile ─────────────────────────────────────────────────
  ADD COLUMN IF NOT EXISTS is_rte boolean,
  ADD COLUMN IF NOT EXISTS medium_of_instruction text,
  ADD COLUMN IF NOT EXISTS previous_school_address text,
  ADD COLUMN IF NOT EXISTS previous_school_block text,
  ADD COLUMN IF NOT EXISTS previous_school_district text,
  ADD COLUMN IF NOT EXISTS previous_school_state text,
  ADD COLUMN IF NOT EXISTS previous_school_udise_code text,
  ADD COLUMN IF NOT EXISTS previous_school_reason_for_leaving text,
  ADD COLUMN IF NOT EXISTS previous_class_studied text,
  ADD COLUMN IF NOT EXISTS previous_school_board text,
  -- Text, not numeric: board roll numbers can be alphanumeric.
  ADD COLUMN IF NOT EXISTS board_roll_number text,
  ADD COLUMN IF NOT EXISTS board_percentage numeric(5, 2),
  -- Text: schools record this as "92%" or "180/210 days".
  ADD COLUMN IF NOT EXISTS last_session_attendance text,
  ADD COLUMN IF NOT EXISTS is_staff_ward boolean,
  ADD COLUMN IF NOT EXISTS participates_ncc boolean,
  ADD COLUMN IF NOT EXISTS participates_nss boolean,
  ADD COLUMN IF NOT EXISTS participates_scouts boolean,
  ADD COLUMN IF NOT EXISTS participates_competitions boolean,
  ADD COLUMN IF NOT EXISTS distance_band text,
  -- Template item 12 is ONE dropdown covering mother/father/legal guardian —
  -- "completed highest education level" of whichever parent it applies to.
  ADD COLUMN IF NOT EXISTS parent_highest_education text;

ALTER TABLE students DROP CONSTRAINT IF EXISTS chk_students_minority_group;
ALTER TABLE students ADD CONSTRAINT chk_students_minority_group CHECK (
  minority_group IS NULL
  OR minority_group IN ('muslim', 'sikh', 'christian', 'jain', 'buddhist', 'parsi', 'none')
);

ALTER TABLE students DROP CONSTRAINT IF EXISTS chk_students_medium;
ALTER TABLE students ADD CONSTRAINT chk_students_medium CHECK (
  medium_of_instruction IS NULL
  OR medium_of_instruction IN ('english', 'hindi')
);

ALTER TABLE students DROP CONSTRAINT IF EXISTS chk_students_distance_band;
ALTER TABLE students ADD CONSTRAINT chk_students_distance_band CHECK (
  distance_band IS NULL
  OR distance_band IN ('1-3km', '3-5km', '5-10km', 'above-10km')
);

ALTER TABLE students DROP CONSTRAINT IF EXISTS chk_students_parent_highest_education;
ALTER TABLE students ADD CONSTRAINT chk_students_parent_highest_education CHECK (
  parent_highest_education IS NULL
  OR parent_highest_education IN (
    'primary', 'upper_primary', 'secondary', 'senior_secondary',
    'graduation', 'pg_or_more'
  )
);

ALTER TABLE students DROP CONSTRAINT IF EXISTS chk_students_height_cm;
ALTER TABLE students ADD CONSTRAINT chk_students_height_cm CHECK (
  height_cm IS NULL OR (height_cm > 0 AND height_cm < 300)
);

ALTER TABLE students DROP CONSTRAINT IF EXISTS chk_students_weight_kg;
ALTER TABLE students ADD CONSTRAINT chk_students_weight_kg CHECK (
  weight_kg IS NULL OR (weight_kg > 0 AND weight_kg < 500)
);

ALTER TABLE students DROP CONSTRAINT IF EXISTS chk_students_board_percentage;
ALTER TABLE students ADD CONSTRAINT chk_students_board_percentage CHECK (
  board_percentage IS NULL OR (board_percentage >= 0 AND board_percentage <= 100)
);
