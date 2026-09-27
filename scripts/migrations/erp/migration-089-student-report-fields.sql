-- migration-089-student-report-fields.sql
--
-- Adds the student columns the Custom Report Builder needs to reach parity
-- with the old ERP's 111-field "Student Custom Report" (see
-- tasks/custom-report-builder.md §2.3). Four approved groups: government /
-- board identifiers, contact & identity extras, admissions-desk fields, and
-- the previous-school marks trio.
--
-- Why flat columns on `students` and not new tables: every one of these is a
-- single value per student that exists only to be printed in a row of a
-- report. The moment one of them needs workflow — a counsellor with a queue,
-- caution money with a ledger — it earns its own table. None do today.
--
-- Two exceptions that are deliberately NOT here:
--   • House — students change house between sessions, so it belongs on the
--     enrollment, not the student. See migration 090.
--   • "OldNew" — derivable from admission_date vs. the session's date range.
--     Never store what you can compute; `student_type` below is the manual
--     override for when the derivation is wrong, not a duplicate of it.
--
-- Every column is NULLABLE, following migration 072: bulk uploads arrive
-- partially filled, and for enum-ish columns "unknown" must stay
-- distinguishable from a real value. Format rules for identifiers live in Zod
-- rather than CHECK constraints so one dirty cell can't fail a 100-row upsert
-- batch. Enum-ish columns DO get CHECKs, because app-side normalization maps
-- unrecognised values to NULL before insert.
--
-- Idempotent.

-- ─── 1. Columns ─────────────────────────────────────────────────────────────

ALTER TABLE students
  -- ── Government / board identifiers ────────────────────────────────────
  -- PEN (Permanent Education Number, 11 digits) and APAAR (12 digits) are
  -- UDISE+ mandated; they were going to be needed with or without this
  -- feature. Text, not numeric: leading zeros are significant.
  ADD COLUMN IF NOT EXISTS pen_number text,
  ADD COLUMN IF NOT EXISTS apaar_number text,
  ADD COLUMN IF NOT EXISTS cbse_registration_no text,
  ADD COLUMN IF NOT EXISTS nic_number text,

  -- ── Contact & identity extras ─────────────────────────────────────────
  -- Salutations print on certificates and letters ("S/o Shri …").
  ADD COLUMN IF NOT EXISTS father_salutation text,
  ADD COLUMN IF NOT EXISTS mother_salutation text,
  -- `address` + `present_pincode` stay the free-text present address; these
  -- two are separate because reports and UDISE returns group by them.
  ADD COLUMN IF NOT EXISTS district text,
  ADD COLUMN IF NOT EXISTS state text,
  ADD COLUMN IF NOT EXISTS place_of_birth text,
  ADD COLUMN IF NOT EXISTS office_address text,
  ADD COLUMN IF NOT EXISTS mother_office_address text,
  -- Distinct from both addresses: where the school posts things.
  ADD COLUMN IF NOT EXISTS mailing_address text,
  -- Which of the four mobile columns actually receives SMS. The old ERP
  -- stored a duplicated "Sms Mobile No" string and let it drift out of sync
  -- with the real numbers; a pointer cannot drift.
  ADD COLUMN IF NOT EXISTS sms_mobile_source text,
  -- Caste is NOT `category`: category is the reservation bucket
  -- (General/SC/ST/OBC/MBC), caste is the community name within it.
  ADD COLUMN IF NOT EXISTS caste text,
  ADD COLUMN IF NOT EXISTS area_type text,

  -- ── Admissions desk ───────────────────────────────────────────────────
  -- Flat reporting columns, NOT an admissions CRM. `registration_requests`
  -- remains the enquiry pipeline; these record what the desk wrote on the
  -- paper form at admission time.
  ADD COLUMN IF NOT EXISTS registration_no text,
  ADD COLUMN IF NOT EXISTS registration_date date,
  ADD COLUMN IF NOT EXISTS form_no text,
  ADD COLUMN IF NOT EXISTS admission_confirm_date date,
  ADD COLUMN IF NOT EXISTS counsellor_name text,
  ADD COLUMN IF NOT EXISTS counsellor_remark text,
  ADD COLUMN IF NOT EXISTS staff_reference text,
  -- Manual override for the derived New/Old classification.
  ADD COLUMN IF NOT EXISTS student_type text,
  ADD COLUMN IF NOT EXISTS caution_money_receipt_no text,
  ADD COLUMN IF NOT EXISTS caution_money_receipt_date date,
  ADD COLUMN IF NOT EXISTS caution_money_amount numeric(12, 2),

  -- ── Previous-school marks ─────────────────────────────────────────────
  -- Completes the Previous School group already on the registry, which stops
  -- at `board_percentage` (= the old ERP's "Pre.Percentage").
  ADD COLUMN IF NOT EXISTS previous_school_max_marks numeric(7, 2),
  ADD COLUMN IF NOT EXISTS previous_school_obtained_marks numeric(7, 2),
  ADD COLUMN IF NOT EXISTS previous_school_result text;

-- ─── 2. Enum-ish CHECKs ─────────────────────────────────────────────────────
-- Lowercase canonical values; the app normalizes input and maps anything
-- unrecognised to NULL before insert (migration 072's rule).

ALTER TABLE students DROP CONSTRAINT IF EXISTS chk_students_father_salutation;
ALTER TABLE students ADD CONSTRAINT chk_students_father_salutation CHECK (
  father_salutation IS NULL
  OR father_salutation IN ('mr', 'shri', 'dr', 'prof', 'late', 'capt', 'col')
);

ALTER TABLE students DROP CONSTRAINT IF EXISTS chk_students_mother_salutation;
ALTER TABLE students ADD CONSTRAINT chk_students_mother_salutation CHECK (
  mother_salutation IS NULL
  OR mother_salutation IN ('mrs', 'ms', 'smt', 'dr', 'prof', 'late')
);

ALTER TABLE students DROP CONSTRAINT IF EXISTS chk_students_sms_mobile_source;
ALTER TABLE students ADD CONSTRAINT chk_students_sms_mobile_source CHECK (
  sms_mobile_source IS NULL
  OR sms_mobile_source IN ('student', 'father', 'mother', 'guardian')
);

ALTER TABLE students DROP CONSTRAINT IF EXISTS chk_students_area_type;
ALTER TABLE students ADD CONSTRAINT chk_students_area_type CHECK (
  area_type IS NULL OR area_type IN ('rural', 'urban')
);

ALTER TABLE students DROP CONSTRAINT IF EXISTS chk_students_student_type;
ALTER TABLE students ADD CONSTRAINT chk_students_student_type CHECK (
  student_type IS NULL OR student_type IN ('new', 'old', 'transfer')
);

-- Marks are non-negative and obtained never exceeds maximum. Both sides
-- NULL-tolerant: sheets routinely carry one without the other.
ALTER TABLE students DROP CONSTRAINT IF EXISTS chk_students_previous_marks;
ALTER TABLE students ADD CONSTRAINT chk_students_previous_marks CHECK (
  (previous_school_max_marks IS NULL OR previous_school_max_marks >= 0)
  AND (previous_school_obtained_marks IS NULL OR previous_school_obtained_marks >= 0)
  AND (
    previous_school_max_marks IS NULL
    OR previous_school_obtained_marks IS NULL
    OR previous_school_obtained_marks <= previous_school_max_marks
  )
);

-- Caution money is an amount held, never negative.
ALTER TABLE students DROP CONSTRAINT IF EXISTS chk_students_caution_money_amount;
ALTER TABLE students ADD CONSTRAINT chk_students_caution_money_amount CHECK (
  caution_money_amount IS NULL OR caution_money_amount >= 0
);

-- ─── 3. Identifier uniqueness ───────────────────────────────────────────────
-- PEN and APAAR are national identifiers: two students sharing one is always
-- a data-entry error, and finding it years later (when a board return is
-- rejected) is far more expensive than failing the import row now.
--
-- Partial indexes so the overwhelmingly common NULL stays unconstrained —
-- a plain UNIQUE would still allow multiple NULLs in Postgres, but the
-- partial index also keeps the index small while adoption is sparse.

CREATE UNIQUE INDEX IF NOT EXISTS idx_students_pen_number_unique
  ON students (pen_number) WHERE pen_number IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_students_apaar_number_unique
  ON students (apaar_number) WHERE apaar_number IS NOT NULL;

-- Not unique, only looked up: the admissions desk searches by form number.
CREATE INDEX IF NOT EXISTS idx_students_form_no
  ON students (form_no) WHERE form_no IS NOT NULL;

COMMENT ON COLUMN students.sms_mobile_source IS
  'Which mobile column receives SMS: student|father|mother|guardian. A pointer, '
  'not a copy — the old ERP duplicated the number and let it drift.';
COMMENT ON COLUMN students.student_type IS
  'Manual override for the New/Old classification that is otherwise derived '
  'from admission_date against the session date range.';
COMMENT ON COLUMN students.caste IS
  'Community name. Distinct from students.category, which is the reservation '
  'bucket (General/SC/ST/OBC/MBC).';
