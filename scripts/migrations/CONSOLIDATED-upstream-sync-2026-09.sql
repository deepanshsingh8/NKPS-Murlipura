-- =====================================================================
-- CONSOLIDATED MIGRATION — ERP + CMS sync with NKPS upstream (September 2026)
--                          + Class Diary (Murlipura)
-- =====================================================================
-- Upstream: github.com/deepanshsingh8/NKPS @ 2886b25 (2026-09-22)
-- Previous sync: 00ac881 → CONSOLIDATED-upstream-sync-2026-08.sql
--
-- Runs AFTER CONSOLIDATED-upstream-sync-2026-08.sql and after
-- cms/migration-901 + base/migration-902 (both already live on Murlipura as
-- of 2026-09-27 — verified against the database, see tasks/upstream-sync-2026-09.md).
--
-- Run ONCE, top to bottom, in the Supabase SQL editor for the Murlipura
-- project. Each section is the migration file verbatim, in ascending number
-- order (the repo's apply order), with two Murlipura changes:
--
--   110 — the school_profile seed row is Murlipura's (name, address, phones,
--         e-mails, RBSE, geo), not upstream's Rajawas row. The file in
--         base/migration-110-school-profile.sql carries the same change.
--   104 — preceded by DROP POLICY IF EXISTS for the policies it creates, so
--         the script stays safe to re-run (104 on its own is not).
--
-- and one Murlipura-only feature at the end:
--
--   903 — Class Diary: class_diary_posts, class_diary_reads, and the private
--         "class-diary" storage bucket.
--
-- Pre-flight (2026-09-27, read-only against the live Murlipura DB): every
-- table, column, function and view these migrations touch exists in the
-- shape they expect; the transport policies are exactly the four 104 drops;
-- timetable_assignment_drift has the column list 119 re-creates; and 903 was
-- executed inside a rolled-back transaction.
--
-- NOT INCLUDED: scripts/_apply-ai-feature-migrations.sql,
-- scripts/_enable-ai-assistant.sql — the assistant stays off
-- (school_profile.ai_enabled = false) until someone turns it on deliberately,
-- and it needs ANTHROPIC_API_KEY in the ERP's environment first.
-- =====================================================================

-- =====================================================================
-- WRONG-DATABASE GUARD — do not remove. See the August script for why.
-- =====================================================================
do $$
begin
  if to_regclass('public.holiday_homework') is null
     or to_regclass('public.prospectus_documents') is null then
    raise exception
      'WRONG DATABASE - aborted, nothing was changed. This script targets the NKPS Murlipura project, but the Murlipura-only tables holiday_homework / prospectus_documents were not found. Switch projects in the Supabase dashboard and re-run.';
  end if;
end $$;



-- #####################################################################
-- ### erp/migration-086-enrollment-history-integrity.sql
-- #####################################################################
-- Migration 086 — enrollment history integrity.
--
-- ── Why this exists (the live bug) ──────────────────────────────────────────
-- Three code paths already ORDER BY `student_enrollments.created_at`, a column
-- that has never existed on this table (the redesign added `updated_at` only):
--
--   apps/erp/src/lib/report-card.ts            .order("created_at", …)
--   apps/erp/src/app/api/results/by-student/…  selects created_at
--   apps/erp/src/lib/final-result.ts           .select("class_id, created_at")
--                                              .order("created_at")
--
-- All three discard the PostgREST error, so the 42703 ("column does not
-- exist") silently yields `data = null`. The observable damage:
--
--   * getReportCardData() gets enrollment = null → every report card renders
--     with no class, no section, no roll number, no grade scale and no
--     attendance block.
--   * computeFinalResult() returns null for every student → year-final
--     compute produces nothing.
--
-- Verified against the live database before writing this migration: the exact
-- report-card query returns `42703 column student_enrollments.created_at does
-- not exist`, while the identical query without the .order() returns the row.
-- Adding the column is therefore the fix, not a nice-to-have. The call sites
-- are also changed in the same commit to stop swallowing the error, so the
-- next silent 42703 is visible instead of invisible.
--
-- ── The other two changes ───────────────────────────────────────────────────
-- `source` / `import_batch_id` mirror what `results` and `fee_payments`
-- already carry, so a backfilled past-year enrollment is distinguishable from
-- an ERP-native one and a whole import batch stays revertible.
--
-- UNIQUE(student_id, academic_year_id) encodes the school's actual rule: a
-- student sits in exactly one class for the whole session (confirmed with the
-- school — mid-year section transfers do not happen here). The pre-existing
-- UNIQUE(student_id, class_id) could not express this, because `classes` are
-- year-scoped: it stops the same class twice but allows two different classes
-- in one year. Pre-flight against live data before applying: 944 enrollment
-- rows, 0 students holding more than one row in the same academic year.

-- ─── 1. created_at ──────────────────────────────────────────────────────────
-- Backfilled from updated_at: for rows that were never edited the two are
-- equal, and for the rest it is the closest available approximation of when
-- the row appeared. Nothing older exists to recover.

ALTER TABLE student_enrollments
  ADD COLUMN IF NOT EXISTS created_at timestamptz;

UPDATE student_enrollments
  SET created_at = COALESCE(updated_at, now())
  WHERE created_at IS NULL;

ALTER TABLE student_enrollments
  ALTER COLUMN created_at SET DEFAULT now(),
  ALTER COLUMN created_at SET NOT NULL;

-- ─── 2. Provenance ──────────────────────────────────────────────────────────
-- 'bulk_backfill'     — past-year roster typed/imported from an old spreadsheet
-- 'historical_import' — created as a side effect of the legacy-ERP importers
-- 'erp_native'        — created by this ERP in the normal course of business

ALTER TABLE student_enrollments
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'erp_native'
    CHECK (source IN ('erp_native', 'historical_import', 'bulk_backfill')),
  ADD COLUMN IF NOT EXISTS import_batch_id uuid;

CREATE INDEX IF NOT EXISTS student_enrollments_import_batch_idx
  ON student_enrollments(import_batch_id)
  WHERE import_batch_id IS NOT NULL;

-- ─── 3. One enrollment per student per academic year ────────────────────────
-- Run this first; it must return zero rows or the constraint below fails:
--
--   SELECT student_id, academic_year_id, count(*)
--   FROM student_enrollments
--   GROUP BY student_id, academic_year_id
--   HAVING count(*) > 1;

ALTER TABLE student_enrollments
  DROP CONSTRAINT IF EXISTS student_enrollments_student_year_unique;

ALTER TABLE student_enrollments
  ADD CONSTRAINT student_enrollments_student_year_unique
  UNIQUE (student_id, academic_year_id);


-- #####################################################################
-- ### erp/migration-087-student-status-history.sql
-- #####################################################################
-- Migration 087 — student status history (why a student left, tracked over time).
--
-- Today `PATCH /api/students/status` writes `student_enrollments.status` and
-- flips `students.is_active`, and that is all: marking a student Exited or
-- Terminated records no reason and no actor, so a year later nobody can say
-- why a name disappeared from the roster.
--
-- ── Why an append-only table, not columns ───────────────────────────────────
-- Columns on student_enrollments would hold only the LATEST transition. A real
-- student path is active → exited → active → terminated, and each new hop
-- would destroy the previous reason — precisely the loss this feature exists
-- to prevent. The table is authoritative; three denormalised cache columns are
-- added alongside purely so the students list can show "why" without an N+1.
--
-- `publish_events` was considered and rejected: it has no from/to status or
-- enrollment reference (the transition would have to be stuffed into free-text
-- `note` and become unqueryable), its RLS is admin-read-only while status
-- changes are an editor-permitted action, and it is semantically the
-- results-publishing log.
--
-- ── Why an RPC ─────────────────────────────────────────────────────────────
-- PostgREST gives the app no client-side transaction. A status UPDATE followed
-- by a separate history INSERT can leave a status change with no reason on
-- record if the second call fails — the exact failure mode the feature guards
-- against. change_enrollment_status() does both in one transaction, and also
-- collapses the route's current 4+N round trips into one.

-- ─── 1. The history table ───────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS student_status_history (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id       uuid NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  -- SET NULL, not CASCADE: an audit row must outlive the enrollment it
  -- describes (same reasoning as migration 046's audit-log FK sweep).
  enrollment_id    uuid REFERENCES student_enrollments(id) ON DELETE SET NULL,
  academic_year_id uuid REFERENCES academic_years(id) ON DELETE SET NULL,
  class_id         uuid REFERENCES classes(id) ON DELETE SET NULL,
  from_status text CHECK (from_status IN ('active','passed','failed','terminated','exited')),
  to_status   text NOT NULL
    CHECK (to_status IN ('active','passed','failed','terminated','exited')),
  reason      text,
  source      text NOT NULL DEFAULT 'manual'
    CHECK (source IN ('manual','bulk','promotion','bulk_import','historical_import','system')),
  changed_by  uuid REFERENCES profiles(id) ON DELETE SET NULL,
  changed_at  timestamptz NOT NULL DEFAULT now(),
  -- The requirement, enforced at the lowest level so no future writer — route,
  -- script or console session — can record an exit without saying why.
  CONSTRAINT student_status_history_reason_required CHECK (
    to_status NOT IN ('terminated','exited')
    OR (reason IS NOT NULL AND length(btrim(reason)) >= 5)
  )
);

CREATE INDEX IF NOT EXISTS idx_ssh_student
  ON student_status_history(student_id, changed_at DESC);
CREATE INDEX IF NOT EXISTS idx_ssh_enrollment
  ON student_status_history(enrollment_id, changed_at DESC);

ALTER TABLE student_status_history ENABLE ROW LEVEL SECURITY;

-- Reads are admin-only. Writes go exclusively through the service-role client
-- (the RPC below), so no INSERT/UPDATE/DELETE policy is granted to anyone.
DROP POLICY IF EXISTS "Admins read student_status_history" ON student_status_history;
CREATE POLICY "Admins read student_status_history"
  ON student_status_history FOR SELECT
  USING (public.get_user_role() = 'admin');

-- ─── 2. Denormalised latest-value cache ─────────────────────────────────────
-- Lets the students table render the reason inline without joining history per
-- row. The table above stays the source of truth.

ALTER TABLE student_enrollments
  ADD COLUMN IF NOT EXISTS status_reason     text,
  ADD COLUMN IF NOT EXISTS status_changed_at timestamptz,
  ADD COLUMN IF NOT EXISTS status_changed_by uuid REFERENCES profiles(id) ON DELETE SET NULL;

-- ─── 3. Atomic status change ────────────────────────────────────────────────
-- p_updates: [{"enrollment_id": uuid, "status": text, "reason": text|null}, …]
--
-- Per element: reads the current row, skips no-ops, inserts a history row,
-- updates the status plus the cache columns, and finally flips
-- students.is_active for the affected students in two set-based statements.
--
-- The reason CHECK on student_status_history is what actually enforces the
-- "terminated/exited must have a reason" rule; the API validates too, for a
-- readable error, but the DB is the backstop.

CREATE OR REPLACE FUNCTION public.change_enrollment_status(
  p_updates jsonb,
  p_actor   uuid DEFAULT NULL,
  p_source  text DEFAULT 'manual'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_item        jsonb;
  v_enrollment  record;
  v_new_status  text;
  v_reason      text;
  v_updated     int := 0;
  v_skipped     int := 0;
  v_inactive    uuid[] := ARRAY[]::uuid[];
  v_reactivated uuid[] := ARRAY[]::uuid[];
BEGIN
  IF jsonb_typeof(p_updates) <> 'array' THEN
    RAISE EXCEPTION 'p_updates must be a JSON array';
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_updates)
  LOOP
    v_new_status := v_item ->> 'status';
    v_reason     := NULLIF(btrim(COALESCE(v_item ->> 'reason', '')), '');

    SELECT se.id, se.student_id, se.class_id, se.academic_year_id, se.status
      INTO v_enrollment
      FROM student_enrollments se
      WHERE se.id = (v_item ->> 'enrollment_id')::uuid
      FOR UPDATE;

    IF NOT FOUND THEN
      v_skipped := v_skipped + 1;
      CONTINUE;
    END IF;

    -- A no-op still counts as skipped rather than writing a history row that
    -- records no transition.
    IF v_enrollment.status IS NOT DISTINCT FROM v_new_status THEN
      v_skipped := v_skipped + 1;
      CONTINUE;
    END IF;

    INSERT INTO student_status_history (
      student_id, enrollment_id, academic_year_id, class_id,
      from_status, to_status, reason, source, changed_by
    ) VALUES (
      v_enrollment.student_id, v_enrollment.id, v_enrollment.academic_year_id,
      v_enrollment.class_id, v_enrollment.status, v_new_status, v_reason,
      p_source, p_actor
    );

    UPDATE student_enrollments
      SET status            = v_new_status,
          status_reason     = v_reason,
          status_changed_at = now(),
          status_changed_by = p_actor,
          updated_at        = now()
      WHERE id = v_enrollment.id;

    IF v_new_status IN ('terminated', 'exited') THEN
      v_inactive := v_inactive || v_enrollment.student_id;
    ELSE
      v_reactivated := v_reactivated || v_enrollment.student_id;
    END IF;

    v_updated := v_updated + 1;
  END LOOP;

  -- students.is_active gates the admin listing, so it has to track the
  -- enrollment status. Set-based, after the loop, so a student appearing twice
  -- in one payload settles on their final state.
  IF array_length(v_inactive, 1) > 0 THEN
    UPDATE students
      SET is_active = false, updated_at = now()
      WHERE id = ANY(v_inactive) AND is_active IS DISTINCT FROM false;
  END IF;

  IF array_length(v_reactivated, 1) > 0 THEN
    UPDATE students
      SET is_active = true, updated_at = now()
      WHERE id = ANY(v_reactivated)
        AND id <> ALL(v_inactive)
        AND is_active IS DISTINCT FROM true;
  END IF;

  RETURN jsonb_build_object('updated', v_updated, 'skipped', v_skipped);
END;
$$;

-- Callable only by the service-role client (the API route). No grant to
-- anon/authenticated: status changes are authorised in the route via
-- verifyAdminOrEditorWithUser("students").
REVOKE ALL ON FUNCTION public.change_enrollment_status(jsonb, uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.change_enrollment_status(jsonb, uuid, text) FROM anon, authenticated;

-- ─── 4. Backfill ────────────────────────────────────────────────────────────
-- Seed one history row per enrollment that is already in a non-active state,
-- so the timeline isn't blank for students who left before this shipped. The
-- reason is explicitly marked unknown rather than invented; `source='system'`
-- keeps these distinguishable from real recorded transitions, and the CHECK
-- above is satisfied because the placeholder is a genuine ≥5-char string.

INSERT INTO student_status_history (
  student_id, enrollment_id, academic_year_id, class_id,
  from_status, to_status, reason, source, changed_by, changed_at
)
SELECT se.student_id, se.id, se.academic_year_id, se.class_id,
       NULL, se.status,
       'Recorded before reason tracking existed — original reason unknown',
       'system', NULL, COALESCE(se.updated_at, now())
FROM student_enrollments se
WHERE se.status <> 'active'
  AND NOT EXISTS (
    SELECT 1 FROM student_status_history h WHERE h.enrollment_id = se.id
  );


-- #####################################################################
-- ### erp/migration-088-subject-delete-integrity.sql
-- #####################################################################
-- =============================================================================
-- Migration 088 — Subject delete integrity
-- =============================================================================
-- Admins reported "Failed to delete subject" on /academics/subjects for any
-- subject that appears anywhere in a timetable.
--
-- Cause: timetable_periods.subject_id was created without an ON DELETE action,
-- so it defaulted to NO ACTION. Every other foreign key pointing at
-- subjects(id) — class_subjects, stream_subjects, results, exam_schedules,
-- result_master_subjects, class_tests, supplementary_attempts,
-- elective_slot_options, student_elective_picks — is ON DELETE CASCADE. The
-- odd one out turned a supported action into a 23503 the UI surfaced as a bare
-- "Failed to delete subject" with no reason.
--
-- Fix: bring the FK in line with its nine siblings. Deleting a subject now
-- removes the periods that taught it, which is what the page's confirmation
-- has always promised. Break periods (is_break = true) carry a NULL subject_id
-- and are untouched — a cascade only reaches rows whose subject_id matches the
-- deleted subject.
--
-- Marks are NOT protected by this FK and never were: results, class_tests and
-- supplementary_attempts all cascade. That protection now lives in the admin
-- proxy, which refuses any delete that would strand academic records
-- (packages/shared/src/lib/row-dependencies.ts). The DB stays permissive so
-- an intentional admin cleanup is still possible via SQL.
--
-- Idempotent: safe to re-run.
-- =============================================================================

ALTER TABLE timetable_periods
  DROP CONSTRAINT IF EXISTS timetable_periods_subject_id_fkey;

ALTER TABLE timetable_periods
  ADD CONSTRAINT timetable_periods_subject_id_fkey
  FOREIGN KEY (subject_id) REFERENCES subjects(id) ON DELETE CASCADE;

-- Verification — expect delete_rule = 'CASCADE'.
--
--   SELECT rc.delete_rule
--     FROM information_schema.referential_constraints rc
--    WHERE rc.constraint_name = 'timetable_periods_subject_id_fkey';


-- #####################################################################
-- ### erp/migration-089-student-report-fields.sql
-- #####################################################################
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


-- #####################################################################
-- ### erp/migration-090-houses.sql
-- #####################################################################
-- migration-090-houses.sql
--
-- House master + per-session house assignment, for the Custom Report Builder's
-- "House Name" column and for house-wise sheets (sports day, assembly,
-- inter-house results).
--
-- ── Why house_id sits on student_enrollments, not students ──────────────────
-- Students change house between sessions — on class promotion into a new wing,
-- or to rebalance house strengths. A column on `students` holds only today's
-- house, so a report run for 2023-24 would print the CURRENT house against a
-- three-year-old cohort: wrong, and wrong in the silent way (a plausible value
-- in every cell). Enrollment is already the per-session row carrying class,
-- section, roll number, status and transport; house belongs beside them.
--
-- ── Why a master table, not a text column ───────────────────────────────────
-- The old ERP used free text and the live data shows exactly what that costs:
-- its house list contains YELLOW, "Yellow House", BLUE, "Blue House", "Ble",
-- GREEN, "Green House", RED, "Red House" — nine rows for four houses, so no
-- house-wise total was ever trustworthy. A FK makes the typo impossible.
--
-- Idempotent.

-- ─── 1. The master ──────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS houses (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text NOT NULL,
  -- Short form for narrow report columns and roll-number prefixes ("R", "BLU").
  code       text,
  -- Hex, for house badges in the UI and colour bands on printed sheets.
  colour     text,
  sort_order integer NOT NULL DEFAULT 0,
  is_active  boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Case-insensitive uniqueness: the whole point is to stop "RED" and "Red
-- House" coexisting. A plain UNIQUE(name) would not.
CREATE UNIQUE INDEX IF NOT EXISTS idx_houses_name_unique
  ON houses (lower(btrim(name)));

ALTER TABLE houses DROP CONSTRAINT IF EXISTS chk_houses_colour;
ALTER TABLE houses ADD CONSTRAINT chk_houses_colour CHECK (
  colour IS NULL OR colour ~ '^#[0-9A-Fa-f]{6}$'
);

-- ─── 2. Assignment ──────────────────────────────────────────────────────────
-- ON DELETE SET NULL, not CASCADE: deleting a house must never delete a
-- student's enrollment row. Deactivating (is_active = false) is the intended
-- path anyway; deletion is the accident this guards.

ALTER TABLE student_enrollments
  ADD COLUMN IF NOT EXISTS house_id uuid REFERENCES houses(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_student_enrollments_house
  ON student_enrollments (house_id) WHERE house_id IS NOT NULL;

-- ─── 3. RLS ─────────────────────────────────────────────────────────────────
-- Mirrors `streams`: readable by everyone (house names are printed on public
-- result sheets and the website's sports pages), writable by admins only.

ALTER TABLE houses ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public can read houses" ON houses;
CREATE POLICY "Public can read houses"
  ON houses FOR SELECT USING (true);

DROP POLICY IF EXISTS "Admins can insert houses" ON houses;
CREATE POLICY "Admins can insert houses"
  ON houses FOR INSERT
  WITH CHECK (public.get_user_role() = 'admin');

DROP POLICY IF EXISTS "Admins can update houses" ON houses;
CREATE POLICY "Admins can update houses"
  ON houses FOR UPDATE
  USING (public.get_user_role() = 'admin');

DROP POLICY IF EXISTS "Admins can delete houses" ON houses;
CREATE POLICY "Admins can delete houses"
  ON houses FOR DELETE
  USING (public.get_user_role() = 'admin');

-- ─── 4. Seed the four canonical houses ──────────────────────────────────────
-- Guarded per row on the case-insensitive name index, so re-running this
-- migration against a populated database cannot resurrect a house the school
-- has since renamed (the failure mode migration 059's section_cards seed hit).

INSERT INTO houses (name, code, colour, sort_order)
VALUES
  ('Red House',    'RED', '#DC2626', 1),
  ('Blue House',   'BLU', '#2563EB', 2),
  ('Green House',  'GRN', '#16A34A', 3),
  ('Yellow House', 'YEL', '#CA8A04', 4)
ON CONFLICT DO NOTHING;

COMMENT ON TABLE houses IS
  'House master. Assignment lives on student_enrollments.house_id because a '
  'student''s house is per-session, not lifelong.';


-- #####################################################################
-- ### erp/migration-091-export-events.sql
-- #####################################################################
-- Migration 091 — export_events (who downloaded which list, and how much of it).
--
-- The admin lists gain a filter-then-download action across every section:
-- students, staff, fees, transport, users. One click on the students list now
-- yields every child's name, class, father's name, address and parent mobile
-- as a file that leaves the building, and nothing records that it happened.
-- This table is that record.
--
-- ── Why not a new FeatureKey instead ───────────────────────────────────────
-- Gating "may export" separately from "may view" would gate nothing: an editor
-- granted `students` already renders every one of those rows on screen, and
-- select-all + copy-paste is an export. The control that actually helps is
-- knowing a bulk extraction occurred (this table) plus withholding contact
-- fields from non-admins (enforced in the export routes), not a checkbox that
-- stops the Download button while the data sits in the DOM.
--
-- ── Why append-only, admin-read, service-role-write ────────────────────────
-- Same posture as student_status_history (087): an audit row must not be
-- editable by the actor it describes. Writes go exclusively through the
-- export routes on the service-role client, so no INSERT/UPDATE/DELETE policy
-- is granted to any role.
--
-- ── Why only server-generated exports appear here ──────────────────────────
-- Non-sensitive operational tables (calendar, buses, stops, exam timetable)
-- build their CSV/XLSX in the browser, and are deliberately NOT logged: a
-- client-side beacon is trivially blocked, and a log that silently misses
-- entries is worse than no log because it reads as complete. The sensitive
-- datasets are routed through the server precisely so that this table IS
-- complete for them.
--
-- `publish_events` was considered and rejected as the sink for the same reason
-- 087 rejected it: its event_type CHECK is results-publishing vocabulary, and
-- every field here would collapse into unqueryable free text.

-- ── What actually writes here ──────────────────────────────────────────────
-- Today: 'students' (the one dataset the server can answer better than the
-- browser — past sessions include students who have since left, and the
-- subject filter needs a two-hop join the list payload does not carry) and
-- 'table_pdf' (every PDF, from any list, since rendering is server-side).
--
-- The other dataset values are reserved. They are listed now so that moving a
-- dataset server-side later is a route change rather than a CHECK-constraint
-- migration — but note that moving one only makes sense when the server can
-- supply something the page cannot. Where the browser already holds every row
-- (staff, users), a server route could withhold nothing and would log an act
-- the page can perform anyway, which is the "complete-looking but hollow"
-- outcome this table is meant to avoid.

CREATE TABLE IF NOT EXISTS export_events (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- SET NULL, not CASCADE: the record of an export must outlive the account
  -- that made it (see migration 046).
  actor_id         uuid REFERENCES profiles(id) ON DELETE SET NULL,
  actor_role       text,
  dataset          text NOT NULL CHECK (dataset IN (
                     'students', 'staff', 'fees_dues', 'transport_assignments',
                     'users', 'registrations', 'table_pdf')),
  feature_key      text,
  format           text NOT NULL CHECK (format IN ('csv', 'xlsx', 'pdf')),
  academic_year_id uuid REFERENCES academic_years(id) ON DELETE SET NULL,
  row_count        integer NOT NULL DEFAULT 0,
  column_count     integer NOT NULL DEFAULT 0,
  fields           text[] NOT NULL DEFAULT '{}',
  -- True when the export included an admin-only field group (contact details,
  -- identity numbers). The one column worth alerting on.
  sensitive        boolean NOT NULL DEFAULT false,
  filter_summary   text,
  filter_spec      jsonb,
  source_app       text CHECK (source_app IN ('erp', 'cms')),
  source_path      text,
  -- text, NOT inet: a malformed X-Forwarded-For would raise 22P02 and, since
  -- the insert rides alongside the download, an audit write must never be able
  -- to fail the download it is describing.
  client_ip        text,
  user_agent       text,
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_export_events_actor
  ON export_events(actor_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_export_events_dataset
  ON export_events(dataset, created_at DESC);
-- Partial: "show me the bulk extractions of contact data" is the query this
-- table exists to answer quickly.
CREATE INDEX IF NOT EXISTS idx_export_events_sensitive
  ON export_events(created_at DESC) WHERE sensitive;

ALTER TABLE export_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins read export_events" ON export_events;
CREATE POLICY "Admins read export_events"
  ON export_events FOR SELECT
  USING (public.get_user_role() = 'admin');


-- #####################################################################
-- ### erp/migration-092-historical-corrections.sql
-- #####################################################################
-- Migration 092 — historical_corrections (what was changed in a closed session,
-- by whom, and why).
--
-- The admin lists gain an academic-session selector, and with it the ability to
-- open a past session and correct it. That is a real need — a class or roll
-- number recorded wrongly three years ago is wrong until someone can fix it —
-- but it is also the one edit in this system with no natural witness. A change
-- to the current session shows up immediately: the class list looks wrong, a
-- teacher says so. A change to 2022-23 is seen by nobody.
--
-- So a closed session opens read-only, and an edit requires an explicit unlock
-- carrying a reason. This table is what the unlock writes.
--
-- ── Why not student_status_history (087) ───────────────────────────────────
-- That table records status transitions only — from_status/to_status — and is
-- written by the change_enrollment_status RPC. A historical correction is
-- usually not a status change at all: it is a wrong class, a wrong roll
-- number, a misspelt name. Those would have to be stuffed into its free-text
-- `reason` and become unqueryable.
--
-- ── Why not export_events (091) ────────────────────────────────────────────
-- Different act. That records data leaving; this records data changing.
--
-- ── Why the snapshots are jsonb, not columns ───────────────────────────────
-- The corrected row may be a `students` row or a `student_enrollments` row,
-- and later a fee or a result. Typed columns would mean a migration per table;
-- before/after snapshots plus target_table cover all of them and keep the
-- question this table answers — "what did this record look like before?" —
-- answerable without joining to a row that has since changed again.

CREATE TABLE IF NOT EXISTS historical_corrections (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- SET NULL, not CASCADE: the record of a correction must outlive the account
  -- that made it (migration 046 set this convention for the audit tables).
  actor_id         uuid REFERENCES profiles(id) ON DELETE SET NULL,
  actor_role       text,
  -- The session that was edited. This is the whole point of the table: it
  -- distinguishes an ordinary edit from one reaching into a closed year.
  academic_year_id uuid REFERENCES academic_years(id) ON DELETE SET NULL,
  student_id       uuid REFERENCES students(id) ON DELETE SET NULL,
  enrollment_id    uuid REFERENCES student_enrollments(id) ON DELETE SET NULL,
  target_table     text NOT NULL,
  target_id        uuid,
  -- Only the columns that actually changed, so reading the log does not mean
  -- diffing two fifty-column blobs by eye.
  changed_columns  text[] NOT NULL DEFAULT '{}',
  before_snapshot  jsonb,
  after_snapshot   jsonb,
  -- Required, and long enough to be a sentence rather than a shrug. The DB
  -- enforces it because the reason is the only thing that makes this edit
  -- reviewable later, and a UI-only check is a suggestion.
  reason           text NOT NULL CHECK (length(btrim(reason)) >= 10),
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_historical_corrections_year
  ON historical_corrections(academic_year_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_historical_corrections_student
  ON historical_corrections(student_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_historical_corrections_actor
  ON historical_corrections(actor_id, created_at DESC);

ALTER TABLE historical_corrections ENABLE ROW LEVEL SECURITY;

-- Admin-read only. Writes go exclusively through the service-role client in the
-- correction path, so no INSERT/UPDATE/DELETE policy is granted to any role —
-- same posture as student_status_history (087) and export_events (091). An
-- audit row that the actor it describes could edit would be worthless.
DROP POLICY IF EXISTS "Admins read historical_corrections" ON historical_corrections;
CREATE POLICY "Admins read historical_corrections"
  ON historical_corrections FOR SELECT
  USING (public.get_user_role() = 'admin');


-- #####################################################################
-- ### erp/migration-093-report-presets.sql
-- #####################################################################
-- migration-093-report-presets.sql
--
-- Saved column/filter selections for the Custom Report Builder.
--
-- Numbered 093, not 091: 091 was claimed by migration-091-export-events on
-- main while this branch was in flight. 093 has never been used anywhere in
-- this repo's history and is the number main's own plan file expects, so it
-- leaves no permanent gap.
--
-- ── Why this exists ─────────────────────────────────────────────────────────
-- The old ERP's report screen saved nothing: /CustomReport 404s, only
-- /CustomReport/Create exists. Every time the office wanted the same contact
-- sheet they re-ticked the same boxes out of 111. That is the single biggest
-- daily cost of the old screen, and it is a table.
--
-- ── Ownership model ─────────────────────────────────────────────────────────
-- Private by default. `is_shared` publishes a preset to everyone who can open
-- the reports screen, and only admins may set it — otherwise any editor could
-- push a preset into every colleague's list.
--
-- created_by IS NULL marks a SYSTEM preset (the two seeded below). They are
-- shared, they belong to nobody, and only an admin can touch them.
--
-- ── Why the session id is stored but overridden at run time ─────────────────
-- `filters` is stored whole, session id included, because a partial filter
-- blob would need bespoke merge logic on load. The UI substitutes the session
-- picker's current value when it applies a preset, so "Class-wise contact
-- sheet" works in any year rather than silently reporting on 2026-27 forever.
--
-- Idempotent.

CREATE TABLE IF NOT EXISTS report_presets (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text NOT NULL,
  -- Room for the planned fee / attendance / result reports without a second
  -- table; each one gets its own field registry but the same preset shape.
  entity     text NOT NULL DEFAULT 'students',
  -- The whole ReportFilters object (packages/shared/src/lib/report-filters.ts).
  filters    jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- Ordered ReportField keys. Unknown keys are dropped on load rather than
  -- erroring, so retiring a field does not break every saved preset.
  fields     text[] NOT NULL DEFAULT '{}',
  is_shared  boolean NOT NULL DEFAULT false,
  created_by uuid REFERENCES profiles(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT report_presets_name_not_blank CHECK (length(btrim(name)) > 0),
  CONSTRAINT report_presets_entity_known CHECK (entity IN ('students'))
);

-- ON DELETE CASCADE above, not SET NULL: a deleted user's private presets
-- should go with them. SET NULL would silently promote them to system presets,
-- which is the opposite of what anyone intends.

-- One name per owner. Partial, because NULL owners (system presets) need
-- their own global uniqueness — and in Postgres NULL <> NULL, so a single
-- composite unique index would let duplicate system presets through.
CREATE UNIQUE INDEX IF NOT EXISTS idx_report_presets_owner_name
  ON report_presets (created_by, lower(btrim(name)))
  WHERE created_by IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_report_presets_system_name
  ON report_presets (lower(btrim(name)))
  WHERE created_by IS NULL;

CREATE INDEX IF NOT EXISTS idx_report_presets_visible
  ON report_presets (entity, is_shared, created_by);

-- ─── RLS ────────────────────────────────────────────────────────────────────
-- Defence in depth: the API also checks ownership explicitly, but a preset is
-- per-user data and the table should be safe on its own.

ALTER TABLE report_presets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Read own or shared report_presets" ON report_presets;
CREATE POLICY "Read own or shared report_presets"
  ON report_presets FOR SELECT
  USING (created_by = auth.uid() OR is_shared OR public.get_user_role() = 'admin');

-- A caller may only create presets owned by themselves, and may not publish
-- one unless they are an admin.
DROP POLICY IF EXISTS "Insert own report_presets" ON report_presets;
CREATE POLICY "Insert own report_presets"
  ON report_presets FOR INSERT
  WITH CHECK (
    created_by = auth.uid()
    AND (is_shared = false OR public.get_user_role() = 'admin')
  );

DROP POLICY IF EXISTS "Update own report_presets" ON report_presets;
CREATE POLICY "Update own report_presets"
  ON report_presets FOR UPDATE
  USING (created_by = auth.uid() OR public.get_user_role() = 'admin')
  WITH CHECK (
    (created_by = auth.uid() OR public.get_user_role() = 'admin')
    AND (is_shared = false OR public.get_user_role() = 'admin')
  );

DROP POLICY IF EXISTS "Delete own report_presets" ON report_presets;
CREATE POLICY "Delete own report_presets"
  ON report_presets FOR DELETE
  USING (created_by = auth.uid() OR public.get_user_role() = 'admin');

-- ─── Seed: two system presets ───────────────────────────────────────────────
-- So the screen is not empty on day one, and so the two reports the office
-- actually runs are one click.
--
-- Field keys must exist in packages/shared/src/lib/report-fields.ts. Unknown
-- keys are dropped silently on load, so a typo here degrades to a missing
-- column rather than an error — scripts/_verify-report-fields.mts is what
-- catches that.
--
-- `serial` and `student_name` are omitted deliberately: they are always-on and
-- get prepended by resolveFields().

INSERT INTO report_presets (name, entity, filters, fields, is_shared, created_by)
VALUES
  (
    'Contact Sheet',
    'students',
    '{"statuses":["active"],"sort_by":"class_section","then_by":"student_name"}'::jsonb,
    ARRAY[
      'admission_no', 'class_section', 'roll_number',
      'father_name', 'father_mobile', 'mother_mobile', 'phone'
    ],
    true,
    NULL
  ),
  (
    'UDISE+ Extract',
    'students',
    '{"statuses":["active"],"sort_by":"class_section","then_by":"student_name"}'::jsonb,
    ARRAY[
      'admission_no', 'class_name', 'section', 'gender', 'date_of_birth',
      'father_name', 'mother_name', 'category', 'minority_group',
      'is_bpl', 'is_ews', 'is_cwsn', 'is_rte', 'medium_of_instruction',
      'pen_number', 'apaar_number', 'aadhar_number', 'distance_band',
      'parent_highest_education'
    ],
    true,
    NULL
  )
ON CONFLICT DO NOTHING;

COMMENT ON COLUMN report_presets.created_by IS
  'NULL means a system preset: shared, owned by nobody, admin-only to modify.';


-- #####################################################################
-- ### erp/migration-094-teacher-substitutions.sql
-- #####################################################################
-- Migration 094: Teacher absences + substitutions.
--
-- Planning layer on top of the existing `timetable_periods` table (which
-- already models the regular weekly schedule). Two new tables:
--
--   teacher_absences  — one row per teacher per date they're absent.
--                       Optional half_day flag for partial-day absences
--                       (medical appointments, school duties, etc.)
--   substitutions     — one row per (absence × affected period) once an
--                       admin assigns a substitute teacher. Absence of a row
--                       for an affected period means "not yet assigned" —
--                       there is no separate `pending` state.
--
-- Why we use timetable_periods.id (not class_id+period_number) as the link
-- to the affected period: classes run on STAGGERED schedules in this school
-- (verified empirically — see scripts/_check-period-times.mjs), so the
-- substitute-availability algorithm matches by time-range overlap, not by
-- period_number. Using the period UUID gives us a single stable join target
-- that already encodes (class_id, day_of_week, period_number, start_time,
-- end_time) without us having to re-encode it in the substitutions row.
--
-- Idempotent: safe to re-run.
--
-- NUMBERING HISTORY: originally authored as 030, shipped as
-- `migration-031-teacher-substitutions.sql` (bumped because 030 was taken
-- by timetable-teacher-unique), which collided with `031-db-hygiene.sql`.
-- Renumbered to 094 on 2026-08-22 to break the duplicate prefix. 031 stays
-- with db-hygiene, which downstream docs and migration 043 already cite as
-- "Migration 031". Environments that applied this as 031 need no action --
-- the file is unchanged apart from this header and re-running is safe.

-- ─── 1. teacher_absences ────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS teacher_absences (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  teacher_id uuid NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
  absence_date date NOT NULL,
  half_day text NOT NULL DEFAULT 'full'
    CHECK (half_day IN ('full', 'first_half', 'second_half')),
  reason text,
  marked_by uuid REFERENCES profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (teacher_id, absence_date)
);

CREATE INDEX IF NOT EXISTS idx_teacher_absences_date
  ON teacher_absences(absence_date);

CREATE INDEX IF NOT EXISTS idx_teacher_absences_teacher
  ON teacher_absences(teacher_id);

-- ─── 2. substitutions ───────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS substitutions (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  absence_id uuid NOT NULL REFERENCES teacher_absences(id) ON DELETE CASCADE,
  timetable_period_id uuid NOT NULL REFERENCES timetable_periods(id) ON DELETE CASCADE,
  -- Nullable so deleting a teacher (rare; usually soft-deleted via is_active)
  -- doesn't wipe the historical substitution record.
  substitute_teacher_id uuid REFERENCES teachers(id) ON DELETE SET NULL,
  note text,
  assigned_by uuid REFERENCES profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (absence_id, timetable_period_id)
);

CREATE INDEX IF NOT EXISTS idx_substitutions_absence
  ON substitutions(absence_id);

CREATE INDEX IF NOT EXISTS idx_substitutions_substitute_teacher
  ON substitutions(substitute_teacher_id);

CREATE INDEX IF NOT EXISTS idx_substitutions_period
  ON substitutions(timetable_period_id);

-- ─── 3. updated_at triggers ─────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.teacher_absences_touch_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS teacher_absences_set_updated_at ON teacher_absences;
CREATE TRIGGER teacher_absences_set_updated_at
  BEFORE UPDATE ON teacher_absences
  FOR EACH ROW EXECUTE FUNCTION public.teacher_absences_touch_updated_at();

CREATE OR REPLACE FUNCTION public.substitutions_touch_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS substitutions_set_updated_at ON substitutions;
CREATE TRIGGER substitutions_set_updated_at
  BEFORE UPDATE ON substitutions
  FOR EACH ROW EXECUTE FUNCTION public.substitutions_touch_updated_at();

-- ─── 4. RLS ─────────────────────────────────────────────────────────────────
-- Defense-in-depth. The actual access gate is in the API layer
-- (verifyAdminOrEditor("teacher_substitutions") + service-role client which
-- bypasses RLS). These policies block direct browser-client access to
-- sensitive HR data (absence reasons) and let admins query directly via
-- the Supabase dashboard.

ALTER TABLE teacher_absences ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins manage teacher_absences" ON teacher_absences;
CREATE POLICY "Admins manage teacher_absences"
  ON teacher_absences FOR ALL
  USING (public.get_user_role() = 'admin')
  WITH CHECK (public.get_user_role() = 'admin');

ALTER TABLE substitutions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins manage substitutions" ON substitutions;
CREATE POLICY "Admins manage substitutions"
  ON substitutions FOR ALL
  USING (public.get_user_role() = 'admin')
  WITH CHECK (public.get_user_role() = 'admin');


-- #####################################################################
-- ### erp/migration-095-missing-fk-indexes.sql
-- #####################################################################
-- migration-095-missing-fk-indexes.sql
--
-- Adds indexes on foreign-key columns that carry real query traffic but had
-- none. Postgres does NOT create an index for a FK constraint automatically —
-- only for PRIMARY KEY and UNIQUE. Every filter and join on these columns was
-- therefore a sequential scan, and every DELETE on the parent row scanned the
-- child table to check the constraint.
--
-- An audit of the schema found 27 unindexed FK columns. Most sit on small
-- master tables where a scan costs nothing and an index would only add write
-- overhead; those are deliberately left alone. The ones below were selected
-- because they are filtered or joined on hot paths, on tables that grow with
-- enrolment and time.
--
-- Purely additive and reversible: no table is rewritten, no behaviour changes,
-- and each statement is IF NOT EXISTS so the file is safe to re-run.
--
-- Note on CONCURRENTLY: omitted deliberately. CREATE INDEX CONCURRENTLY cannot
-- run inside a transaction block, and the Supabase SQL editor wraps submissions
-- in one. These tables are small enough at a single school's scale that the
-- brief write lock is not worth the operational complexity. For a large
-- existing dataset, run each statement separately with CONCURRENTLY added.

-- fee_payments: the largest transactional table. Every year-scoped fee query
-- (dues register, collection dashboard, receipts, reports) filters on this.
CREATE INDEX IF NOT EXISTS idx_fee_payments_academic_year_id
  ON fee_payments(academic_year_id);

-- class_tests: only created_by and is_published were indexed. The screen that
-- actually matters lists tests for one class, usually narrowed to a subject.
CREATE INDEX IF NOT EXISTS idx_class_tests_class_id
  ON class_tests(class_id);
CREATE INDEX IF NOT EXISTS idx_class_tests_subject_id
  ON class_tests(subject_id);

-- class_subjects: class_id and teacher_id were indexed, subject_id was not.
-- teacherTeachesClassSubject() and the subject-assignment screens both hit it.
CREATE INDEX IF NOT EXISTS idx_class_subjects_subject_id
  ON class_subjects(subject_id);

-- timetable_periods: indexed on (class_id, day_of_week) and teacher_id. The
-- substitution planner and subject-load views filter by subject.
CREATE INDEX IF NOT EXISTS idx_timetable_periods_subject_id
  ON timetable_periods(subject_id);

-- exam_schedules: covered for (exam_type_id, class_id) and exam_date, but a
-- per-subject lookup had nothing to use.
CREATE INDEX IF NOT EXISTS idx_exam_schedules_subject_id
  ON exam_schedules(subject_id);

-- student_enrollments: student_id, class_id, academic_year_id and status are
-- all indexed; stream_id was missed. Stream-filtered rosters are common in
-- XI-XII where streams exist at all.
CREATE INDEX IF NOT EXISTS idx_student_enrollments_stream_id
  ON student_enrollments(stream_id);

-- marksheet_publications: publish/finalize checks look up "is this exam type
-- published for this class", and only the published_by/unpublished_by actor
-- columns were indexed.
CREATE INDEX IF NOT EXISTS idx_marksheet_publications_exam_type_id
  ON marksheet_publications(exam_type_id);

-- student_status_history: written on every status change and read as a
-- per-student timeline; the year and class columns back the filtered views.
CREATE INDEX IF NOT EXISTS idx_student_status_history_academic_year_id
  ON student_status_history(academic_year_id);
CREATE INDEX IF NOT EXISTS idx_student_status_history_class_id
  ON student_status_history(class_id);


-- #####################################################################
-- ### cms/migration-098-restrict-staff-pii.sql
-- #####################################################################
-- migration-098-restrict-staff-pii.sql
--
-- URGENT. Closes an unauthenticated read of staff personal data.
--
-- `teachers` and `staff_members` each carried a policy of the form
--
--     CREATE POLICY "Public can read teachers" ON teachers
--       FOR SELECT USING (true);
--
-- A policy with no TO clause applies to PUBLIC, which includes the `anon`
-- role. The anon key is public by design — it ships inside the marketing
-- site's JavaScript bundle — so anyone on the internet could issue
-- `GET /rest/v1/teachers?select=*` and read, for every member of staff:
--
--   teachers       — aadhar_number, date_of_birth, address, phone, email
--   staff_members  — date_of_birth, address, phone, email, license_number
--
-- Aadhaar numbers and home addresses of employees, readable without logging
-- in. Under India's DPDP Act 2023 this is a reportable class of breach.
--
-- Why it went unnoticed: the policies read as though they exist to serve the
-- public staff directory on the marketing site. That page does need staff
-- data — but only names, subjects, photos and qualifications, and only for
-- teaching categories. It was selecting `*`, so the PII was travelling to
-- every visitor's browser as well as being available to direct API calls.
--
-- The fix separates the two needs:
--   1. The base tables become authenticated-only. Every ERP screen that reads
--      them from the browser is behind a login, so nothing in the admin app
--      changes. Nothing in the marketing site reads `teachers` at all.
--   2. A view, `public_staff_directory`, exposes ONLY the safe columns to
--      anon. It is the single public surface, so widening it is a deliberate
--      act rather than an accident of `select("*")`.
--
-- Deploy order does not matter. The directory component falls back to its
-- bundled static staff list whenever the query errors, so neither
-- "migration first" nor "code first" breaks the public page.
--
-- Every block below is guarded on the table actually existing. The first run
-- of this file aborted on `student_elective_picks` — created by migration 049,
-- which this database never received — and because the whole file is one
-- transaction, the staff-PII fix rolled back with it. A table that isn't there
-- has no policy to tighten and must not be able to block the part that
-- matters. The guards make the file safe to run against any deployment,
-- whatever subset of migrations it has seen.

begin;

-- ── teachers ────────────────────────────────────────────────────────────────
-- No public consumer exists; this table is read only by ERP screens (classes,
-- subjects, timetable, substitutions, staff) and by server routes.
do $$
begin
  if to_regclass('public.teachers') is null then
    raise notice 'skip: teachers does not exist';
    return;
  end if;
  drop policy if exists "Public can read teachers" on teachers;
  drop policy if exists "Authenticated can read teachers" on teachers;
  create policy "Authenticated can read teachers"
    on teachers for select
    to authenticated
    using (true);
end $$;

-- ── staff_members ───────────────────────────────────────────────────────────
do $$
begin
  if to_regclass('public.staff_members') is null then
    raise notice 'skip: staff_members does not exist';
    return;
  end if;
  drop policy if exists "Public can view staff members" on staff_members;
  drop policy if exists "Authenticated can read staff members" on staff_members;
  create policy "Authenticated can read staff members"
    on staff_members for select
    to authenticated
    using (true);
end $$;

-- ── public directory ────────────────────────────────────────────────────────
-- The view runs with its OWNER's rights, which is the default for every
-- Postgres version (the opt-in `security_invoker = true` is 15+, and naming
-- it explicitly as false broke this file on 14 — so it is simply omitted).
-- Owner rights are the point here: the view is not blocked by the
-- authenticated-only policy above, and it can only ever return the columns
-- named below. This IS the curated public projection.
--
-- The category filter is applied here as well as in the component: the public
-- directory lists teaching and management staff, never bus drivers or peons,
-- and that should not depend on a client-side filter being remembered.
do $$
begin
  if to_regclass('public.staff_members') is null then
    raise notice 'skip: public_staff_directory needs staff_members';
    return;
  end if;

  execute $v$
    create or replace view public_staff_directory as
      select id, name, subject, category, photo_url, qualifications, sort_order
      from staff_members
      where is_active = true
        and category in (
          'management', 'pgt', 'tgt', 'prt', 'motherTeachers', 'admin'
        )
  $v$;

  execute 'grant select on public_staff_directory to anon, authenticated';

  execute $c$
    comment on view public_staff_directory is
      'The only staff data readable without logging in. Columns are '
      'deliberately limited: staff_members also holds date_of_birth, address, '
      'phone, email and license_number, none of which may ever be added here. '
      'See migration 098.'
  $c$;
end $$;

-- ── student roster enumeration ──────────────────────────────────────────────
-- `student_subjects` and `student_elective_picks` are both keyed on
-- student_id and were also readable by anon. Joined against the (legitimately
-- public) classes and subjects tables, that hands an unauthenticated caller
-- the complete student UUID keyspace plus each student's stream and subject
-- choices — the input to every other student_id-parameterised probe.
--
-- Neither table has a single browser-side reader: every consumer is a server
-- route on the service-role client, which bypasses RLS entirely. Restricting
-- them to authenticated therefore changes no working behaviour.
do $$
declare
  t text;
begin
  foreach t in array array['student_subjects', 'student_elective_picks'] loop
    if to_regclass('public.' || t) is null then
      -- student_elective_picks comes from migration 049; a database that never
      -- received it simply has nothing to tighten here.
      raise notice 'skip: % does not exist', t;
      continue;
    end if;
    execute format('drop policy if exists %I on %I', 'Public can read ' || t, t);
    execute format('drop policy if exists %I on %I', 'Authenticated can read ' || t, t);
    execute format(
      'create policy %I on %I for select to authenticated using (true)',
      'Authenticated can read ' || t, t
    );
  end loop;
end $$;

commit;


-- #####################################################################
-- ### erp/migration-102-rls-hoist-per-row-calls.sql
-- #####################################################################
-- migration-102-rls-hoist-per-row-calls.sql
--
-- WHY --------------------------------------------------------------------
-- Every RLS policy in this database calls its helper as a bare scalar:
--
--     USING (get_user_role() = 'admin')
--
-- Postgres cannot hoist that. Two things make it expensive here:
--
--   1. The call is not wrapped in a scalar subselect, so it is re-evaluated
--      ONCE PER ROW SCANNED rather than once per query.
--   2. The helpers are SECURITY DEFINER. The planner refuses to inline a SQL
--      function when prosecdef is true, so each call is a real function
--      invocation running its own `SELECT role FROM profiles WHERE id = ...`.
--
-- Measured on this database (944 students; anon vs service-role; medians of
-- 11 runs):
--
--     students              110ms -> 388ms    (+277ms of pure RLS CPU)
--     student_enrollments   113ms -> 387ms    (+273ms)
--     timetable_periods     111ms -> 111ms    (  +0ms - no helper in its policy)
--     fee_structures        109ms -> 110ms    (  +0ms)
--
-- Linear in rows scanned, which proves per-row evaluation:
--       1 row (PK lookup)  -> +4ms
--     944 rows (full scan) -> +209ms
-- Extrapolated: ~1.5s of RLS CPU per query at 5,000 students.
--
-- THE FIX ----------------------------------------------------------------
-- Wrapping the call as (SELECT get_user_role()) makes it an uncorrelated
-- InitPlan: evaluated once per query, reused for every row. The helpers are
-- STABLE and take no arguments, so this is EXACTLY semantics-preserving.
-- No policy's meaning changes.
--
-- WHY THIS IS A DO BLOCK AND NOT A LIST OF DROP/CREATE --------------------
-- supabase-schema.sql is NOT a faithful mirror of the live policy set.
-- migration-erp-redesign.sql drops the original policy names ("Users can read
-- own profile", ...) and replaces them with a different scheme
-- (profiles_select_own, students_select_admin, ...), and that rename was never
-- mirrored into supabase-schema.sql - the file still lists only the old names
-- and none of the new ones. The redesign demonstrably ran: the teachers /
-- parents / payment_orders / notifications tables it creates are live.
--
-- So a hand-written DROP POLICY "<old name>" + CREATE POLICY would DROP
-- nothing (the name is not there) and CREATE a SECOND policy alongside the
-- live one. Permissive policies are OR-ed, so that would WIDEN ACCESS.
--
-- Rewriting from pg_policies instead means we transform whatever is actually
-- installed, whatever it is called. It is correct under drift by construction.
--
-- SAFETY PROPERTIES ------------------------------------------------------
--   * ALTER POLICY only - never creates or drops a policy, so the policy set
--     is identical before and after. Only the expression text changes.
--   * Idempotent: an already-wrapped call is left alone (sentinel guard), so
--     re-running is a no-op.
--   * Every statement is RAISE NOTICE'd before execution, so the migration
--     output is a full audit of what changed.
--   * Scoped to the tables where the cost was actually measured.
--
-- WHAT IS DELIBERATELY NOT TOUCHED ---------------------------------------
--   * `IN (SELECT get_my_class_ids())` / get_my_children_ids(). A
--     set-returning function inside IN (SELECT ...) is ALREADY an
--     uncorrelated InitPlan. Correct as written - do not "fix" these.
--   * teachers / staff_members - migration-098-restrict-staff-pii.sql is
--     concurrently rewriting those to close an unauthenticated read. Doing
--     them here would race that fix. Follow-up once 098 lands.
--   * The tail of low-traffic master/CMS tables. All the measured cost is on
--     the tables listed below.
--
-- VERIFY AFTER APPLYING --------------------------------------------------
--   -- 1. confirm nothing is left un-wrapped on these tables:
--   SELECT tablename, policyname, qual FROM pg_policies
--    WHERE schemaname='public'
--      AND (qual ~ '(?<![T] )get_user_role' OR with_check ~ 'get_user_role');
--   -- 2. as an authenticated non-admin:
--   EXPLAIN (ANALYZE, BUFFERS) SELECT id FROM students;
--   -- the tell is get_user_role collapsing to `InitPlan 1`.
--   -- Expect students to drop ~388ms -> ~115ms.
-- ─────────────────────────────────────────────────────────────────────────

BEGIN;

DO $mig$
DECLARE
  r        record;
  q        text;
  w        text;
  stmt     text;
  changed  int := 0;
  scanned  int := 0;
  -- Scalar, zero-argument, STABLE helpers. Set-returning helpers
  -- (get_my_class_ids, get_my_children_ids) are excluded on purpose.
  fns text[] := ARRAY[
    'get_user_role',
    'get_my_student_id',
    'get_my_teacher_id',
    'get_my_parent_id'
  ];
  fn   text;
  tabs text[] := ARRAY[
    'profiles','students','student_enrollments','results','attendance',
    'fee_payments','parents','report_presets','student_subjects',
    'class_tests','class_test_results','non_scholastic_assessments',
    'student_remarks','ptm_notes','supplementary_attempts'
  ];
BEGIN
  FOR r IN
    SELECT tablename, policyname, qual, with_check
      FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename = ANY(tabs)
     ORDER BY tablename, policyname
  LOOP
    scanned := scanned + 1;
    q := r.qual;
    w := r.with_check;

    FOREACH fn IN ARRAY fns LOOP
      -- Order matters. Park already-wrapped and schema-qualified forms behind
      -- sentinels first, so the bare replacement cannot corrupt them into
      -- `public.(SELECT f())` or double-wrap an existing `(SELECT f())`.
      q := replace(q, '( SELECT '||fn||'()',        '@@W@@'||fn);
      q := replace(q, '(SELECT '||fn||'()',         '@@W@@'||fn);
      q := replace(q, '( SELECT public.'||fn||'()', '@@P@@'||fn);
      q := replace(q, '(SELECT public.'||fn||'()',  '@@P@@'||fn);
      q := replace(q, 'public.'||fn||'()',          '@@Q@@'||fn);
      q := replace(q, fn||'()',            '(SELECT '||fn||'())');
      q := replace(q, '@@Q@@'||fn,         '(SELECT public.'||fn||'())');
      q := replace(q, '@@P@@'||fn,         '(SELECT public.'||fn||'()');
      q := replace(q, '@@W@@'||fn,         '(SELECT '||fn||'()');

      w := replace(w, '( SELECT '||fn||'()',        '@@W@@'||fn);
      w := replace(w, '(SELECT '||fn||'()',         '@@W@@'||fn);
      w := replace(w, '( SELECT public.'||fn||'()', '@@P@@'||fn);
      w := replace(w, '(SELECT public.'||fn||'()',  '@@P@@'||fn);
      w := replace(w, 'public.'||fn||'()',          '@@Q@@'||fn);
      w := replace(w, fn||'()',            '(SELECT '||fn||'())');
      w := replace(w, '@@Q@@'||fn,         '(SELECT public.'||fn||'())');
      w := replace(w, '@@P@@'||fn,         '(SELECT public.'||fn||'()');
      w := replace(w, '@@W@@'||fn,         '(SELECT '||fn||'()');
    END LOOP;

    -- auth.uid() gets the same treatment.
    q := replace(q, '( SELECT auth.uid()', '@@A@@');
    q := replace(q, '(SELECT auth.uid()',  '@@A@@');
    q := replace(q, 'auth.uid()',          '(SELECT auth.uid())');
    q := replace(q, '@@A@@',               '(SELECT auth.uid()');
    w := replace(w, '( SELECT auth.uid()', '@@A@@');
    w := replace(w, '(SELECT auth.uid()',  '@@A@@');
    w := replace(w, 'auth.uid()',          '(SELECT auth.uid())');
    w := replace(w, '@@A@@',               '(SELECT auth.uid()');

    CONTINUE WHEN q IS NOT DISTINCT FROM r.qual
              AND w IS NOT DISTINCT FROM r.with_check;

    stmt := format('ALTER POLICY %I ON public.%I', r.policyname, r.tablename);
    IF q IS NOT NULL THEN stmt := stmt || format(' USING (%s)', q); END IF;
    IF w IS NOT NULL THEN stmt := stmt || format(' WITH CHECK (%s)', w); END IF;

    RAISE NOTICE '%;', stmt;
    EXECUTE stmt;
    changed := changed + 1;
  END LOOP;

  RAISE NOTICE 'migration-102: scanned % policies, rewrote %.', scanned, changed;

  IF changed = 0 THEN
    RAISE WARNING 'migration-102 changed nothing. Either it has already been '
                  'applied, or the helper names differ from those expected.';
  END IF;
END
$mig$;

-- ─────────────────────────────────────────────────────────────────────────
-- BUG FIX (a real behaviour change, not a rewrite)
--
-- The teacher policy on student_subjects compares class_subjects.teacher_id
-- against auth.uid(). But class_subjects.teacher_id REFERENCES teachers(id),
-- while auth.uid() is profiles.id / auth.users.id - two different UUID
-- spaces. The predicate is ALWAYS FALSE, so teachers see ZERO
-- student_subjects rows today. Every other policy in the schema correctly
-- uses get_my_teacher_id() for this.
--
-- Written defensively: the redesign may have renamed this policy, so we fix
-- whichever policy on student_subjects still carries the broken comparison.
-- ─────────────────────────────────────────────────────────────────────────
DO $fix$
DECLARE r record; q text; n int := 0;
BEGIN
  FOR r IN
    SELECT policyname, qual FROM pg_policies
     WHERE schemaname='public' AND tablename='student_subjects'
       AND qual LIKE '%teacher_id%' AND qual LIKE '%auth.uid()%'
  LOOP
    q := replace(r.qual, 'teacher_id = (SELECT auth.uid())',
                         'teacher_id = (SELECT get_my_teacher_id())');
    q := replace(q,      'teacher_id = auth.uid()',
                         'teacher_id = (SELECT get_my_teacher_id())');
    CONTINUE WHEN q = r.qual;
    RAISE NOTICE 'BUGFIX ALTER POLICY %I ON student_subjects USING (%)', r.policyname, q;
    EXECUTE format('ALTER POLICY %I ON public.student_subjects USING (%s)', r.policyname, q);
    n := n + 1;
  END LOOP;
  RAISE NOTICE 'migration-102 bugfix: repaired % student_subjects policy(ies).', n;
END
$fix$;

COMMIT;


-- #####################################################################
-- ### erp/migration-103-index-coverage.sql
-- #####################################################################
-- migration-103-index-coverage.sql
--
-- Additive index work only. Every statement here is CREATE INDEX IF NOT
-- EXISTS, so this migration cannot break a read path and is safe to re-run.
--
-- WHY ADDITIVE ONLY ------------------------------------------------------
-- The audit also found 34 redundant indexes (8 exact duplicates of an
-- implicit UNIQUE/PK index, 26 left-prefixes of a wider index). They are NOT
-- dropped here, deliberately.
--
-- supabase-schema.sql has been shown to drift from the live database:
-- migration-erp-redesign.sql renamed ~50 policies without updating the mirror,
-- and student_enrollments.pickup_address exists in migration-053 but appears
-- nowhere in the mirror. Dropping an index because a file says a wider one
-- covers it is exactly the kind of decision that must be made against the live
-- catalog, not against a file we know is stale. Dropping them also buys write
-- amplification and storage back - not read latency - so deferring costs
-- nothing on query speed. See the verification query at the bottom.
--
-- Postgres creates an index for PRIMARY KEY and UNIQUE automatically, but
-- NEVER for a foreign key. An unindexed FK means every DELETE of a parent row
-- sequentially scans the child table.
-- ─────────────────────────────────────────────────────────────────────────

BEGIN;

-- ── Tier 1: unindexed FKs on tables that grow without bound ──────────────
-- Every DELETE FROM profiles / buses / bus_stops currently seq-scans these.

-- transport_change_requests carries six unindexed FKs.
CREATE INDEX IF NOT EXISTS idx_tcr_requested_by      ON transport_change_requests(requested_by);
CREATE INDEX IF NOT EXISTS idx_tcr_reviewed_by       ON transport_change_requests(reviewed_by);
CREATE INDEX IF NOT EXISTS idx_tcr_previous_bus_id   ON transport_change_requests(previous_bus_id);
CREATE INDEX IF NOT EXISTS idx_tcr_amended_bus_id    ON transport_change_requests(amended_bus_id);
CREATE INDEX IF NOT EXISTS idx_tcr_previous_stop_id  ON transport_change_requests(previous_stop_id);
CREATE INDEX IF NOT EXISTS idx_tcr_amended_stop_id   ON transport_change_requests(amended_stop_id);

-- Append-only audit tables. migration-095 skipped these on the grounds that
-- they "sit on small master tables"; they are not master tables and they do
-- not stay small - student_status_history gains a row per student per
-- promotion run.
CREATE INDEX IF NOT EXISTS idx_student_enrollments_status_changed_by
  ON student_enrollments(status_changed_by);
CREATE INDEX IF NOT EXISTS idx_student_status_history_changed_by
  ON student_status_history(changed_by);
CREATE INDEX IF NOT EXISTS idx_teacher_absences_marked_by
  ON teacher_absences(marked_by);
CREATE INDEX IF NOT EXISTS idx_fee_change_requests_reviewed_by
  ON fee_change_requests(reviewed_by);
CREATE INDEX IF NOT EXISTS idx_historical_corrections_enrollment
  ON historical_corrections(enrollment_id);
CREATE INDEX IF NOT EXISTS idx_fee_change_audit_source_request
  ON fee_change_audit_log(source_request_id);

-- ── Tier 2: remaining unindexed join columns ─────────────────────────────
-- migration-095 added exam_schedules(subject_id) but missed class_id, which
-- is only ever the SECOND column of idx_exam_schedules_exam_class and so has
-- no leading index of its own.
CREATE INDEX IF NOT EXISTS idx_exam_schedules_class_id
  ON exam_schedules(class_id);
CREATE INDEX IF NOT EXISTS idx_result_masters_grade_scale_id
  ON result_masters(grade_scale_id);
CREATE INDEX IF NOT EXISTS idx_students_alumni_academic_year_id
  ON students(alumni_academic_year_id);
CREATE INDEX IF NOT EXISTS idx_export_events_academic_year_id
  ON export_events(academic_year_id);
CREATE INDEX IF NOT EXISTS idx_buses_conductor_id
  ON buses(conductor_id);
CREATE INDEX IF NOT EXISTS idx_elective_slot_options_subject_id
  ON elective_slot_options(subject_id);

-- ── Composites matching the query shapes the app actually issues ─────────
-- Each was cross-checked against the .eq()/.in()/.order() chains in apps/erp.

-- The hottest shape in the codebase: 15 call sites do
--   .eq("class_id", ...).eq("status","active").order("roll_number")
-- idx_enrollments_active is (student_id, class_id, academic_year_id) WHERE
-- status='active' - it leads with student_id, so a class-roster read cannot
-- use it and falls back to the single-column class_id index plus a sort.
CREATE INDEX IF NOT EXISTS idx_enrollments_class_status_roll
  ON student_enrollments(class_id, status, roll_number);

-- 14 sites: .eq(student_id)[.eq(academic_year_id)].order(enrollment_date DESC).
-- UNIQUE(student_id, class_id) cannot serve the ordering, so this sorts today.
CREATE INDEX IF NOT EXISTS idx_enrollments_student_year_date
  ON student_enrollments(student_id, academic_year_id, enrollment_date DESC);

-- 7 sites on the marksheet path. Only (class_id, subject_id) and a separate
-- (exam_type_id) exist, so neither serves this pair.
CREATE INDEX IF NOT EXISTS idx_results_class_exam
  ON results(class_id, exam_type_id);

-- 6 sites: the student fee ledger.
CREATE INDEX IF NOT EXISTS idx_fee_payments_student_year_date
  ON fee_payments(student_id, academic_year_id, payment_date DESC);

-- The two /api/students list endpoints, which order by full_name and split on
-- is_alumni. Partial so each index only carries the rows its endpoint reads.
CREATE INDEX IF NOT EXISTS idx_students_active_name
  ON students(full_name) WHERE is_alumni = false;
CREATE INDEX IF NOT EXISTS idx_students_alumni_year_name
  ON students(alumni_passing_year, full_name) WHERE is_alumni = true;

ANALYZE;

COMMIT;

-- ─────────────────────────────────────────────────────────────────────────
-- FOLLOW-UP: the 34 redundant indexes.
--
-- Run this against the LIVE database to confirm which are genuinely covered
-- before dropping anything. It lists every index whose column list is a
-- leading prefix of another index on the same table.
--
--   SELECT  n.nspname, c.relname AS table_name,
--           i1.relname AS redundant_index,
--           i2.relname AS covered_by
--     FROM  pg_index x1
--     JOIN  pg_class i1 ON i1.oid = x1.indexrelid
--     JOIN  pg_class c  ON c.oid  = x1.indrelid
--     JOIN  pg_namespace n ON n.oid = c.relnamespace
--     JOIN  pg_index x2 ON x2.indrelid = x1.indrelid
--                      AND x2.indexrelid <> x1.indexrelid
--     JOIN  pg_class i2 ON i2.oid = x2.indexrelid
--    WHERE  n.nspname = 'public'
--      AND  NOT x1.indisprimary AND NOT x1.indisunique
--      AND  x1.indpred IS NULL AND x2.indpred IS NULL
--      AND  array_to_string(x2.indkey,' ') LIKE array_to_string(x1.indkey,' ') || '%'
--    ORDER  BY 2, 3;
--
-- Anything this query returns is safe to DROP INDEX. Anything it does not
-- return is NOT redundant, whatever supabase-schema.sql implies.
-- ─────────────────────────────────────────────────────────────────────────

-- Murlipura: make 104 re-runnable (it CREATEs these without dropping first).
DROP POLICY IF EXISTS "Authenticated can read bus_stops" ON public.bus_stops;
DROP POLICY IF EXISTS "Authenticated can read bus_route_stops" ON public.bus_route_stops;
DROP POLICY IF EXISTS "Authenticated can read bus_stop_fees" ON public.bus_stop_fees;
DROP POLICY IF EXISTS "Authenticated can read buses" ON public.buses;


-- #####################################################################
-- ### erp/migration-104-transport-authenticated-only.sql
-- #####################################################################
-- migration-104-transport-authenticated-only.sql
--
-- SECURITY. Closes an unauthenticated read of the school's transport network.
--
-- ── What was exposed ────────────────────────────────────────────────────────
-- Four tables carried a policy of the form
--
--     CREATE POLICY "Public can read bus_stops" ON bus_stops
--       FOR SELECT USING (true);
--
-- A policy with no TO clause applies to PUBLIC, which includes the `anon`
-- role. The anon key is public by design — it ships inside the marketing
-- site's JavaScript bundle — so anyone on the internet could read:
--
--   bus_stops        188 rows: every pickup point, by name
--                    e.g. "34 No. Bus Stand, Niwaru Road"
--   bus_route_stops  which bus serves which stop, i.e. the route map
--   bus_stop_fees    the fee charged at each stop
--   buses            bus_number, registration_number ("RJ 14 PE 9496"),
--                    capacity, driver_id
--
-- Joined, those four answer: *which vehicle, with which number plate, collects
-- children at which of 188 locations.* For a school that is a child-safety
-- exposure, not merely a data leak. Verified by issuing real anon-key requests
-- against production — all four returned HTTP 200 with live rows.
--
-- ── Why `authenticated` is the right level ─────────────────────────────────
-- Nothing public consumes these. `apps/website/src` contains ZERO references
-- to any of the four (grepped). Every real reader is an authenticated ERP
-- surface:
--
--   parent/transport, student/fees          (parents and students)
--   (admin)/transport/{assignments,buses,drivers,changes}
--   api/{transport/assignments,fees/payments,export/students}
--
-- Server-side routes use the service-role client, which bypasses RLS entirely
-- and is unaffected either way.
--
-- Reads stay unrestricted WITHIN the authenticated set rather than scoped per
-- family. That is deliberate: the transport UI legitimately lists every stop
-- (the change-request picker, the assignment grid), so a self-only policy
-- would break those screens. This migration closes the anonymous hole and
-- changes nothing for a logged-in user.
--
-- ── Why DROP-by-name is safe here, unlike migration-102 ────────────────────
-- supabase-schema.sql is known to drift from the live policy set, which is why
-- migration-102 had to be a catalog transform. These four names were read
-- directly from `pg_policies` on the live database, so they are ground truth,
-- not mirror guesswork. The assertion at the bottom fails the migration if any
-- anonymous read survives, so a name that did NOT match cannot pass silently.
--
-- The companion write policies ("Admins write bus_stops", …) are left alone:
-- they gate on get_user_role() = 'admin', which is already false for anon.
-- ─────────────────────────────────────────────────────────────────────────

BEGIN;

-- ── bus_stops ───────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Public can read bus_stops" ON public.bus_stops;
CREATE POLICY "Authenticated can read bus_stops"
  ON public.bus_stops FOR SELECT
  TO authenticated
  USING (true);

-- ── bus_route_stops ─────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Public can read bus_route_stops" ON public.bus_route_stops;
CREATE POLICY "Authenticated can read bus_route_stops"
  ON public.bus_route_stops FOR SELECT
  TO authenticated
  USING (true);

-- ── bus_stop_fees ───────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Public can read bus_stop_fees" ON public.bus_stop_fees;
CREATE POLICY "Authenticated can read bus_stop_fees"
  ON public.bus_stop_fees FOR SELECT
  TO authenticated
  USING (true);

-- ── buses ───────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Public can read buses" ON public.buses;
CREATE POLICY "Authenticated can read buses"
  ON public.buses FOR SELECT
  TO authenticated
  USING (true);

-- ── Assertion: no anonymous read may survive on these four ─────────────────
-- Catches both a policy name that did not match the DROPs above and any future
-- policy that re-opens one of these tables to anon. Aborts the transaction.
DO $assert$
DECLARE leaked text;
BEGIN
  SELECT string_agg(format('%s."%s"', tablename, policyname), ', ')
    INTO leaked
    FROM pg_policies
   WHERE schemaname = 'public'
     AND tablename IN ('bus_stops','bus_route_stops','bus_stop_fees','buses')
     AND cmd IN ('SELECT','ALL')
     AND permissive = 'PERMISSIVE'
     -- roles containing public/anon means unauthenticated callers are included
     AND (roles::text[] && ARRAY['public','anon'])
     -- ...and the predicate does not itself exclude them
     AND coalesce(qual, 'true') = 'true';

  IF leaked IS NOT NULL THEN
    RAISE EXCEPTION
      'migration-104 aborted: these policies still allow anonymous reads of transport data: %',
      leaked;
  END IF;

  RAISE NOTICE 'migration-104: transport tables are no longer readable by anon.';
END
$assert$;

COMMIT;

-- ─────────────────────────────────────────────────────────────────────────
-- VERIFY AFTER APPLYING
--
-- 1. From a shell, with the ANON key — all four must return [] (not rows):
--      curl -s "$SUPABASE_URL/rest/v1/bus_stops?select=name&limit=2" \
--           -H "apikey: $ANON" -H "Authorization: Bearer $ANON"
--
-- 2. Confirm a logged-in parent still sees their transport page, and that
--    /admin/transport/assignments still lists stops and buses.
--
-- 3. The other eight tables granted SELECT to public with USING (true) were
--    reviewed and left alone deliberately:
--      disclosure_items / disclosure_documents / disclosure_board_results
--         — the CBSE mandatory public disclosure page requires them.
--      academic_years / classes / class_subjects / exam_types
--      / elective_slot_options
--         — structural, non-personal, and read by public-facing surfaces.
--    Revisit class_subjects if teacher-to-class assignment is ever considered
--    sensitive; it is the only one of those carrying a person-level FK.
-- ─────────────────────────────────────────────────────────────────────────


-- #####################################################################
-- ### base/migration-110-school-profile.sql
-- #####################################################################
-- migration-110-school-profile.sql
--
-- The school's own identity, moved out of TypeScript and into the database.
--
-- ── Numbering ───────────────────────────────────────────────────────────────
-- This feature owns a reserved block: 110 school_profile, 111 export_events
-- source, 112 ai_audit, and 113 is held for the WhatsApp tables.
--
-- The block exists because sequential numbering failed here. 098 landed on
-- main as cms/migration-098-restrict-staff-pii.sql, then 099, 100 and 101 were
-- each claimed by a parallel branch mid-session — twice onto a number this
-- work had already taken. Renumbering into a gap terminates that race; the
-- gap itself is harmless, since apply order is by number and nothing reads the
-- sequence as contiguous.
--
-- Still re-run the check before adding a file:
--   ls scripts/migrations/*/ | grep -oE 'migration-[0-9]+' | sort | uniq -d
--
-- Filed under base/ rather than erp/ because the public website and the CMS
-- read it too; a website-only deployment still needs the school's name.
--
-- ── Why this exists ─────────────────────────────────────────────────────────
-- Today the school's name, address, phones, affiliation number, leadership
-- and geo coordinates are a hardcoded object in
-- packages/shared/src/lib/constants.ts, and the website assistant's system
-- prompt hardcodes the staff roster on top of that. Two consequences:
--
--   1. The assistant's answers drift from the database every time someone
--      joins or leaves, silently, because nothing links the two.
--   2. A second school means editing TypeScript and redeploying.
--
-- This table fixes both for the surfaces that read it. It is deliberately NOT
-- a multi-tenancy migration: there is no school_id on any other table, and
-- adding one across 77 tables and 260 policies is its own project. What this
-- does is stop new work hardcoding the school, so that project gets smaller
-- rather than larger.
--
-- ── Single row, by construction ─────────────────────────────────────────────
-- `singleton` is a fixed-value column with a unique constraint, so a second
-- row is a database error rather than a support ticket about which row won.
-- When real multi-tenancy arrives, drop the constraint and the column: every
-- reader already goes through getSchoolProfile(), so the shape is ready.
--
-- ── AI columns ──────────────────────────────────────────────────────────────
-- ai_tone and ai_languages steer generated text (report-card remarks, parent
-- replies) per school rather than per deployment. ai_enabled is an off switch
-- a school can hold: it disables every assistant surface without a redeploy,
-- which is what a nervous principal asks for in week one.

CREATE TABLE IF NOT EXISTS school_profile (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Exactly one row. See the note above.
  singleton boolean NOT NULL DEFAULT true,

  -- Identity
  name text NOT NULL,
  short_name text,
  tagline text,
  description text,
  founded_year integer,
  motto text,

  -- Affiliation (CBSE and equivalents)
  board text,
  affiliation_number text,
  school_code text,
  udise_code text,

  -- Contact
  address_line1 text,
  city text,
  state text,
  pin_code text,
  phones text[] NOT NULL DEFAULT '{}',
  emails text[] NOT NULL DEFAULT '{}',
  website_url text,
  office_hours text,

  -- Geo, for transport and map surfaces. Nullable: a school that has not set
  -- a pin should read as "unknown", never as (0, 0) off the coast of Africa.
  latitude numeric(10, 7),
  longitude numeric(10, 7),

  -- Social
  social jsonb NOT NULL DEFAULT '{}'::jsonb,

  -- Assistant configuration
  ai_enabled boolean NOT NULL DEFAULT false,
  ai_tone text NOT NULL DEFAULT 'warm',
  ai_languages text[] NOT NULL DEFAULT ARRAY['en'],
  ai_disclaimer text,

  -- WhatsApp Business (Meta Cloud API). Ids, not secrets — the access token
  -- stays in the environment, never in a table an admin screen can read.
  whatsapp_phone_number_id text,
  whatsapp_waba_id text,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT school_profile_singleton_true CHECK (singleton = true),
  CONSTRAINT school_profile_name_not_blank CHECK (length(btrim(name)) > 0),
  CONSTRAINT school_profile_ai_tone_known CHECK (ai_tone IN ('warm', 'formal', 'neutral')),
  CONSTRAINT school_profile_languages_not_empty CHECK (cardinality(ai_languages) > 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS school_profile_one_row
  ON school_profile (singleton);

DROP TRIGGER IF EXISTS set_updated_at_school_profile ON school_profile;
CREATE TRIGGER set_updated_at_school_profile
  BEFORE UPDATE ON school_profile
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ── RLS ─────────────────────────────────────────────────────────────────────
-- Readable by everyone including anonymous visitors: the public website and
-- the visitor-facing assistant both render from this row, and every column
-- here is already published on the school's own website or its CBSE
-- disclosure page. Nothing private belongs in this table — note the WhatsApp
-- access token is deliberately absent.
--
-- Writes are admin-only.
ALTER TABLE school_profile ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can read school profile" ON school_profile;
CREATE POLICY "Anyone can read school profile"
  ON school_profile FOR SELECT
  USING (true);

DROP POLICY IF EXISTS "Admins manage school profile" ON school_profile;
CREATE POLICY "Admins manage school profile"
  ON school_profile FOR ALL
  USING (public.get_user_role() = 'admin')
  WITH CHECK (public.get_user_role() = 'admin');

-- ── Seed ────────────────────────────────────────────────────────────────────
-- Murlipura: seeded from THIS repo's packages/shared/src/lib/constants.ts
-- SCHOOL (upstream's seed is the Rajawas campus). Mirrors it so
-- nothing visible changes when readers switch over. ai_enabled stays false:
-- the assistant surfaces are turned on deliberately, not by running a
-- migration.
INSERT INTO school_profile (
  name, short_name, tagline, description, founded_year,
  board, affiliation_number,
  address_line1, city, state, pin_code,
  phones, emails, office_hours,
  latitude, longitude,
  social, ai_enabled, ai_tone, ai_languages
)
SELECT
  'NK Public School, Murlipura',
  'NKPS Murlipura',
  'A Relentless Quest for Excellence',
  'NK Public School Murlipura, the founding campus of the NKPS group, has been nurturing young minds in Jaipur since 1985. We offer holistic education from Nursery to Class XII with Science and Commerce streams at the senior-secondary level.',
  1985,
  'RBSE',
  NULL,
  'Arya Nagar, Murlipura',
  'Jaipur',
  'Rajasthan',
  '302039',
  ARRAY['+91-9785500042', '+91-9785500061'],
  ARRAY['nkpsem@gmail.com', 'nkpsjaipur@gmail.com'],
  'Mon–Sat, 9:00 AM – 3:00 PM',
  26.9774,
  75.7884,
  '{}'::jsonb,
  false,
  'warm',
  ARRAY['en', 'hi']
WHERE NOT EXISTS (SELECT 1 FROM school_profile);


-- #####################################################################
-- ### erp/migration-111-export-events-source.sql
-- #####################################################################
-- migration-111-export-events-source.sql
--
-- Record whether an export was taken by a person or produced by the
-- assistant, without disturbing what `dataset` has always meant.
--
-- ── Numbering ───────────────────────────────────────────────────────────────
-- This feature owns a reserved block: 110 school_profile, 111 export_events
-- source, 112 ai_audit, and 113 is held for the WhatsApp tables.
--
-- The block exists because sequential numbering failed here. 098 landed on
-- main as cms/migration-098-restrict-staff-pii.sql, then 099, 100 and 101 were
-- each claimed by a parallel branch mid-session — twice onto a number this
-- work had already taken. Renumbering into a gap terminates that race; the
-- gap itself is harmless, since apply order is by number and nothing reads the
-- sequence as contiguous.
--
-- Still re-run the check before adding a file:
--   ls scripts/migrations/*/ | grep -oE 'migration-[0-9]+' | sort | uniq -d
--
--
-- ── Why a new column and not a new dataset value ────────────────────────────
-- The obvious move is to widen the `dataset` CHECK with an 'ai_query' value.
-- That would be wrong. `dataset` answers "which corpus left the school" —
-- students, staff, fees_dues, and so on — and every existing count, index and
-- future dashboard reads it that way. An AI-produced student sheet is still
-- the student corpus; only the route differs. Adding 'ai_query' would silently
-- reclassify those rows out of 'students' and make "how many student exports
-- happened this term" quietly wrong from the day the feature ships.
--
-- So `dataset` keeps its meaning and `source` carries the new axis. The
-- default is 'manual', which is exactly what every existing row is, so the
-- backfill is the default and no UPDATE is needed.
--
-- ── ai_run_id ───────────────────────────────────────────────────────────────
-- Points at the ai_query_runs row (added in migration 112) that produced
-- the sheet, so an auditor can go from "this CSV left the school" to the
-- question that was asked and the filters that actually ran. Nullable and
-- unconstrained for now: the FK is added alongside ai_query_runs so this
-- migration stays independently applicable.

ALTER TABLE export_events
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'manual';

ALTER TABLE export_events
  ADD COLUMN IF NOT EXISTS ai_run_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'export_events_source_known'
  ) THEN
    ALTER TABLE export_events
      ADD CONSTRAINT export_events_source_known
      CHECK (source IN ('manual', 'ai'));
  END IF;
END $$;

-- Auditors ask "what did the assistant hand out?" far more often than they
-- ask about any single actor, so this is the index that earns its keep.
CREATE INDEX IF NOT EXISTS idx_export_events_ai
  ON export_events (created_at DESC)
  WHERE source = 'ai';

COMMENT ON COLUMN export_events.source IS
  'How the export was produced: manual (a person used an export screen) or ai '
  '(the assistant produced the sheet). Distinct from dataset, which names the '
  'corpus and keeps its original meaning.';

COMMENT ON COLUMN export_events.ai_run_id IS
  'ai_query_runs.id that produced this export, when source = ''ai''. Lets an '
  'auditor trace a downloaded sheet back to the question and the scoped '
  'filters that produced it.';


-- #####################################################################
-- ### erp/migration-112-ai-audit.sql
-- #####################################################################
-- migration-112-ai-audit.sql
--
-- The audit trail for every assistant interaction.
--
-- ── Numbering ───────────────────────────────────────────────────────────────
-- This feature owns a reserved block: 110 school_profile, 111 export_events
-- source, 112 ai_audit, and 113 is held for the WhatsApp tables.
--
-- The block exists because sequential numbering failed here. 098 landed on
-- main as cms/migration-098-restrict-staff-pii.sql, then 099, 100 and 101 were
-- each claimed by a parallel branch mid-session — twice onto a number this
-- work had already taken. Renumbering into a gap terminates that race; the
-- gap itself is harmless, since apply order is by number and nothing reads the
-- sequence as contiguous.
--
-- Still re-run the check before adding a file:
--   ls scripts/migrations/*/ | grep -oE 'migration-[0-9]+' | sort | uniq -d
--
--
-- ── Why this is four tables and not one ─────────────────────────────────────
-- A single "ai_log" row per request cannot answer the question that actually
-- matters in an audit: *did the assistant ever read something the caller was
-- not entitled to?* Answering that needs the model's request and the server's
-- rewrite of it side by side, per tool call, which is a different grain from
-- the conversation and from the message.
--
-- ── The security signal ─────────────────────────────────────────────────────
-- ai_tool_calls stores BOTH args_raw (what the model asked for) and
-- args_scoped (what actually ran after the server injected the row scope).
-- The delta between them is the alarm: a model that tried to widen its own
-- scope shows up as a diff, and error_code = 'scope_violation' is countable.
-- Storing only the executed arguments would hide exactly the attempt worth
-- knowing about.
--
-- ── What is deliberately NOT stored ─────────────────────────────────────────
-- No row contents, ever. Counts, field KEYS and filter shapes only. An audit
-- table that copies the student data it is auditing doubles the blast radius
-- of the thing it exists to protect. Where the rows themselves matter, follow
-- ai_query_runs.id and re-run the query under a fresh authorization check.
--
-- ── RLS: enabled, zero policies, ON PURPOSE ─────────────────────────────────
-- These tables are service-role only. RLS is enabled with no policies so that
-- any client credential reads them as empty.
--
-- The explicit COMMENT on each table saying so is not decoration. An
-- unpolicied table under RLS returns an empty result rather than an error, so
-- the next person to read this schema cannot otherwise distinguish "locked
-- down deliberately" from "someone forgot the policy" — which is precisely
-- how bus_stops/bus_stop_fees came to silently understate transport fees.

-- ── Conversations ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ai_conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Where the request came in. whatsapp has no Supabase session, so user_id
  -- is null there and parent_id carries the identity.
  channel text NOT NULL CHECK (channel IN ('erp_web', 'portal_web', 'whatsapp')),
  feature text NOT NULL CHECK (feature IN ('ask', 'remarks', 'parent')),

  -- Actor. SET NULL so the trail outlives the account, matching export_events
  -- and historical_corrections.
  actor_id uuid REFERENCES profiles(id) ON DELETE SET NULL,
  actor_role text,
  parent_id uuid REFERENCES parents(id) ON DELETE SET NULL,
  teacher_id uuid REFERENCES teachers(id) ON DELETE SET NULL,

  -- The scope this conversation ran under, denormalised so an auditor can
  -- filter without joining every tool call. scope_hash is the fingerprint the
  -- export path re-checks before letting a download proceed.
  scope_kind text NOT NULL CHECK (scope_kind IN ('all', 'classes', 'students')),
  scope_hash text NOT NULL,

  model text NOT NULL,
  academic_year_id uuid REFERENCES academic_years(id) ON DELETE SET NULL,

  status text NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'completed', 'error', 'aborted')),
  error_code text,

  started_at timestamptz NOT NULL DEFAULT now(),
  last_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ai_conversations_actor
  ON ai_conversations (actor_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_conversations_channel
  ON ai_conversations (channel, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_conversations_parent
  ON ai_conversations (parent_id, started_at DESC) WHERE parent_id IS NOT NULL;

-- ── Messages ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ai_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES ai_conversations(id) ON DELETE CASCADE,
  seq integer NOT NULL,

  role text NOT NULL CHECK (role IN ('user', 'assistant')),

  -- The human's own words are kept because support cannot debug "the
  -- assistant gave a wrong answer" without them. The assistant's data-bearing
  -- output is NOT kept here — follow ai_query_runs instead.
  content text,

  input_tokens integer,
  output_tokens integer,
  cache_read_tokens integer,
  cache_write_tokens integer,
  stop_reason text,
  latency_ms integer,

  created_at timestamptz NOT NULL DEFAULT now(),

  UNIQUE (conversation_id, seq)
);

CREATE INDEX IF NOT EXISTS idx_ai_messages_conversation
  ON ai_messages (conversation_id, seq);

-- ── Tool calls ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ai_tool_calls (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES ai_conversations(id) ON DELETE CASCADE,
  message_seq integer,

  tool_name text NOT NULL,

  -- The pair that makes this table worth having. See the header.
  args_raw jsonb,
  args_scoped jsonb,
  scope_applied jsonb,

  -- Shape of what came back, never the contents.
  row_count integer,
  preview_row_count integer,
  field_keys text[] NOT NULL DEFAULT '{}',
  sensitive_included boolean NOT NULL DEFAULT false,

  duration_ms integer,
  error_code text,

  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ai_tool_calls_conversation
  ON ai_tool_calls (conversation_id, created_at);
-- The alert query: scope violations, newest first.
CREATE INDEX IF NOT EXISTS idx_ai_tool_calls_errors
  ON ai_tool_calls (created_at DESC) WHERE error_code IS NOT NULL;

-- ── Query runs ──────────────────────────────────────────────────────────────
-- The handle behind an answer. Holds the SCOPED filters, so re-running is
-- guaranteed to reproduce what the caller was entitled to and nothing wider.
--
-- Deliberately stores no rows: the on-screen table and the CSV re-execute
-- under a fresh authorization check rather than serving a cached result. That
-- costs a second query and means the export re-states its own total, but it
-- keeps a teacher who lost a class between preview and download from
-- exporting stale rows.
CREATE TABLE IF NOT EXISTS ai_query_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid REFERENCES ai_conversations(id) ON DELETE SET NULL,

  filters jsonb NOT NULL,
  field_keys text[] NOT NULL DEFAULT '{}',
  total integer NOT NULL DEFAULT 0,
  capped boolean NOT NULL DEFAULT false,

  -- Re-derived on every read; a mismatch is a 403, not a stale download.
  scope_hash text NOT NULL,
  academic_year_id uuid REFERENCES academic_years(id) ON DELETE SET NULL,

  created_at timestamptz NOT NULL DEFAULT now(),
  -- Checked lazily at read. There is no cron anywhere in this repo, so
  -- nothing here may depend on a sweeper existing.
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '2 hours'),
  exported_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_ai_query_runs_conversation
  ON ai_query_runs (conversation_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_query_runs_expiry
  ON ai_query_runs (expires_at);

-- Close the loop opened in migration 111: an exported sheet points back at the
-- question that produced it. Added here because the target table exists now.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'export_events_ai_run_id_fkey'
  ) THEN
    ALTER TABLE export_events
      ADD CONSTRAINT export_events_ai_run_id_fkey
      FOREIGN KEY (ai_run_id) REFERENCES ai_query_runs(id) ON DELETE SET NULL;
  END IF;
END $$;

-- ── RLS ─────────────────────────────────────────────────────────────────────
ALTER TABLE ai_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_tool_calls ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_query_runs ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE ai_conversations IS
  'RLS enabled with NO policies, intentionally: service-role access only. Any '
  'client credential reads this as empty. Do not add a policy without deciding '
  'what a non-admin should be able to learn about other people''s questions.';
COMMENT ON TABLE ai_messages IS
  'RLS enabled with NO policies, intentionally: service-role access only.';
COMMENT ON TABLE ai_tool_calls IS
  'RLS enabled with NO policies, intentionally: service-role access only. '
  'args_raw vs args_scoped is the scope-widening signal; keep both.';
COMMENT ON TABLE ai_query_runs IS
  'RLS enabled with NO policies, intentionally: service-role access only. '
  'Stores scoped filters, never rows — readers re-execute under a fresh '
  'authorization check.';


-- #####################################################################
-- ### erp/migration-113-whatsapp.sql
-- #####################################################################
-- migration-113-whatsapp.sql
--
-- The WhatsApp channel: phone enrolment, sessions, message log, and a rate
-- limiter that survives more than one server process.
--
-- Part of the reserved 110-113 block for the assistant work. See
-- migration-110-school-profile.sql for why this feature does not use
-- sequential numbering.
--
-- ── A phone number is not a session ─────────────────────────────────────────
-- Webhook signature verification authenticates the PROVIDER, not the parent.
-- SIM swaps happen, handsets are shared within a family, numbers get recycled
-- by carriers. So a number is not accepted as identity on sight: it has to be
-- enrolled once, either by a code sent over the existing Exotel channel or
-- from inside the authenticated portal.
--
-- ── Why not just match parents.phone ────────────────────────────────────────
-- Because `ensureParentRecord` writes `opts.phone || ""` into a NOT NULL
-- column, so that table contains empty strings. A normalisation miss that
-- produced '' would match a pile of unrelated parents at once. This uses its
-- own table with an index that cannot contain a blank.

-- ── Enrolled numbers ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS parent_phone_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid NOT NULL REFERENCES parents(id) ON DELETE CASCADE,

  -- E.164, always. Normalised by normalizeIndianMobile() before it gets here.
  phone_e164 text NOT NULL,

  verified_at timestamptz,
  revoked_at timestamptz,
  -- How the number came to be trusted, for the audit trail.
  verified_via text CHECK (verified_via IN ('otp', 'portal', 'admin')),

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT parent_phone_links_e164 CHECK (phone_e164 ~ '^\+[1-9][0-9]{7,14}$')
);

-- One live claim per number. Partial so a revoked link does not block a
-- family that legitimately inherits a recycled number later.
CREATE UNIQUE INDEX IF NOT EXISTS parent_phone_links_active
  ON parent_phone_links (phone_e164)
  WHERE revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_parent_phone_links_parent
  ON parent_phone_links (parent_id) WHERE revoked_at IS NULL;

-- ── Verification codes ──────────────────────────────────────────────────────
-- Codes are stored HASHED. A leaked table should not hand someone a working
-- second factor, and we never need the plaintext back — only to compare.
CREATE TABLE IF NOT EXISTS parent_phone_otps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phone_e164 text NOT NULL,
  code_hash text NOT NULL,
  parent_id uuid REFERENCES parents(id) ON DELETE CASCADE,
  attempts integer NOT NULL DEFAULT 0,
  consumed_at timestamptz,
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '10 minutes'),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_parent_phone_otps_lookup
  ON parent_phone_otps (phone_e164, created_at DESC);

-- ── Sessions ────────────────────────────────────────────────────────────────
-- A rolling window of trust after enrolment, checked at read. There is no cron
-- anywhere in this repo, so nothing may depend on a sweeper deleting these.
CREATE TABLE IF NOT EXISTS whatsapp_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid NOT NULL REFERENCES parents(id) ON DELETE CASCADE,
  phone_e164 text NOT NULL,
  verified_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '30 days'),
  revoked_at timestamptz,
  last_seen_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS whatsapp_sessions_active
  ON whatsapp_sessions (phone_e164)
  WHERE revoked_at IS NULL;

-- ── Message log ─────────────────────────────────────────────────────────────
-- No raw phone numbers, following the call_logs precedent: the relationship is
-- what matters operationally, and storing the number again just widens what a
-- leak costs. `phone_last4` is enough for a human to reconcile "was that me?"
CREATE TABLE IF NOT EXISTS whatsapp_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  direction text NOT NULL CHECK (direction IN ('inbound', 'outbound')),

  parent_id uuid REFERENCES parents(id) ON DELETE SET NULL,
  phone_last4 text,

  wa_message_id text,
  -- Which billing category this message falls in. Service messages became
  -- billable on 2026-10-01, so this is a cost column, not trivia.
  category text CHECK (category IN ('service', 'utility', 'marketing', 'authentication')),
  template_name text,

  status text NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'sent', 'delivered', 'read', 'failed', 'received')),
  error_code text,

  conversation_id uuid REFERENCES ai_conversations(id) ON DELETE SET NULL,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_whatsapp_messages_parent
  ON whatsapp_messages (parent_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_whatsapp_messages_wa_id
  ON whatsapp_messages (wa_message_id) WHERE wa_message_id IS NOT NULL;

-- ── Rate limiting that actually holds ───────────────────────────────────────
-- The in-memory rateLimit() helper is per-process: on a multi-instance deploy
-- the effective limit is max x instances, and it resets on every deploy. That
-- is fine as politeness on an authenticated screen. It is useless as a control
-- on a public, unauthenticated ingress that costs money per message, so this
-- channel gets a counter the database owns.
CREATE TABLE IF NOT EXISTS ai_rate_limits (
  bucket text NOT NULL,
  window_start timestamptz NOT NULL,
  count integer NOT NULL DEFAULT 0,
  PRIMARY KEY (bucket, window_start)
);

CREATE INDEX IF NOT EXISTS idx_ai_rate_limits_window
  ON ai_rate_limits (window_start);

/**
 * Atomically bump a counter and report whether the caller is still under the
 * limit. One statement, so two concurrent messages cannot both read 4 and both
 * write 5.
 */
CREATE OR REPLACE FUNCTION public.bump_rate_limit(
  p_bucket text,
  p_window_seconds integer,
  p_max integer
) RETURNS boolean AS $$
DECLARE
  v_window timestamptz;
  v_count integer;
BEGIN
  v_window := to_timestamp(floor(extract(epoch FROM now()) / p_window_seconds) * p_window_seconds);

  INSERT INTO ai_rate_limits (bucket, window_start, count)
  VALUES (p_bucket, v_window, 1)
  ON CONFLICT (bucket, window_start)
  DO UPDATE SET count = ai_rate_limits.count + 1
  RETURNING count INTO v_count;

  RETURN v_count <= p_max;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS set_updated_at_parent_phone_links ON parent_phone_links;
CREATE TRIGGER set_updated_at_parent_phone_links
  BEFORE UPDATE ON parent_phone_links
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS set_updated_at_whatsapp_messages ON whatsapp_messages;
CREATE TRIGGER set_updated_at_whatsapp_messages
  BEFORE UPDATE ON whatsapp_messages
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ── RLS ─────────────────────────────────────────────────────────────────────
-- Enabled with NO policies on every table here, intentionally: all five are
-- service-role only. The webhook has no user session at all, and nothing a
-- browser holds should be able to read another family's enrolment or messages.
--
-- The explicit comments matter. An unpolicied table under RLS reads as empty
-- rather than erroring, so without them the next person cannot tell "locked
-- down deliberately" from "someone forgot" — which is how bus_stops came to
-- silently understate transport fees.
ALTER TABLE parent_phone_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE parent_phone_otps ENABLE ROW LEVEL SECURITY;
ALTER TABLE whatsapp_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE whatsapp_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_rate_limits ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE parent_phone_links IS
  'RLS enabled with NO policies, intentionally: service-role only.';
COMMENT ON TABLE parent_phone_otps IS
  'RLS enabled with NO policies, intentionally: service-role only. Codes are '
  'stored hashed; the plaintext is never persisted.';
COMMENT ON TABLE whatsapp_sessions IS
  'RLS enabled with NO policies, intentionally: service-role only.';
COMMENT ON TABLE whatsapp_messages IS
  'RLS enabled with NO policies, intentionally: service-role only. Stores '
  'phone_last4 only, never the full number — see call_logs for the precedent.';
COMMENT ON TABLE ai_rate_limits IS
  'RLS enabled with NO policies, intentionally: service-role only.';


-- #####################################################################
-- ### erp/migration-114-ai-chat-history.sql
-- #####################################################################
-- migration-114-ai-chat-history.sql
--
-- Turns the Ask audit trail into a resumable chat.
--
-- ── This migration reverses a deliberate decision made in 112 ───────────────
-- 112 wrote: "The assistant's data-bearing output is NOT kept here — follow
-- ai_query_runs instead." That was the right call for an audit table. It is
-- the wrong call for a chat, because a conversation you cannot read back is
-- not a conversation — reopening one would show your questions above blank
-- bubbles.
--
-- So ai_messages stops being pure metadata and starts holding student facts:
-- names, counts, fee figures, and — when the caller unlocked sensitive
-- columns — quoted contact details. Three consequences worth naming out loud,
-- because a migration that quietly widens a blast radius is how these things
-- go wrong:
--
--   1. A service-role key leak now yields readable student information from
--      this table, not just counts.
--   2. Erasure and DSAR handling gains a location it did not have.
--   3. The derived text would otherwise outlive its source — ai_query_runs
--      expires in hours while a reply would live forever.
--
-- (3) is answered by redaction on delete: removing a chat NULLs the words and
-- stamps redacted_at, while ai_tool_calls and ai_query_runs are left intact.
-- What an auditor needs — did the assistant read something it should not
-- have? — lives in those two tables, and a user deleting a chat does not get
-- to erase that. The COMMENT rewrite at the bottom records the new deal.

-- ── Conversations: listable, titled, renameable, hideable ───────────────────
ALTER TABLE ai_conversations
  ADD COLUMN IF NOT EXISTS title text,

  -- 'auto' means machine-written and safe to overwrite; 'user' means a human
  -- named it and the titler must never clobber it. A nullable flag rather
  -- than a boolean because a pre-114 row is neither.
  ADD COLUMN IF NOT EXISTS title_source text
    CHECK (title_source IN ('auto', 'user')),

  -- Soft delete. A hard DELETE cascades ai_messages AND ai_tool_calls, which
  -- would let anyone erase the record of what the assistant read simply by
  -- tidying their chat list. The audit outlives the conversation.
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz,
  ADD COLUMN IF NOT EXISTS deleted_by uuid REFERENCES profiles(id) ON DELETE SET NULL;

-- The sidebar query, exactly: mine, this surface, not deleted, newest first.
-- 112's index is on (actor_id, started_at DESC) — the wrong column for a list
-- that reorders every time a reply lands.
CREATE INDEX IF NOT EXISTS idx_ai_conversations_actor_recent
  ON ai_conversations (actor_id, feature, last_at DESC)
  WHERE deleted_at IS NULL;

-- ── Messages: the reply text, per-turn failure, and redaction ───────────────
ALTER TABLE ai_messages
  -- Why a turn ended badly. ai_conversations.status carried this when a
  -- conversation was a single turn; it no longer is, and one aborted turn
  -- must not make the whole chat read as aborted.
  ADD COLUMN IF NOT EXISTS error_code text,

  -- Set when content was blanked by a delete. Distinguishes "the words are
  -- gone" from "the assistant produced no text", which is a real state on the
  -- Stop and budget-exhausted paths.
  ADD COLUMN IF NOT EXISTS redacted_at timestamptz;

-- ── Query runs: which answer owns them, and what to call them ───────────────
ALTER TABLE ai_query_runs
  -- The attribution key. Without it a reopened chat cannot put a result chip
  -- under the answer it belongs to. executeRunStudentReport already receives
  -- this value; it was simply never persisted.
  ADD COLUMN IF NOT EXISTS message_seq integer,

  -- The model's stated intent, denormalised off ai_tool_calls.args_raw.
  -- Reading it back from there is ambiguous: two parallel run_student_report
  -- calls in one round share (conversation_id, message_seq), and nothing
  -- links a tool-call row to the run row it produced.
  ADD COLUMN IF NOT EXISTS purpose text;

-- Two hours is shorter than a school working day, so "open the chat I was on
-- this morning" found every result already expired. A day covers the real
-- unit of work. Anything older goes through the explicit re-run path, which
-- mints a fresh row under a fresh authorization check — the handle stays
-- short-lived, only the window widens.
ALTER TABLE ai_query_runs
  ALTER COLUMN expires_at SET DEFAULT (now() + interval '24 hours');

CREATE INDEX IF NOT EXISTS idx_ai_query_runs_message
  ON ai_query_runs (conversation_id, message_seq)
  WHERE conversation_id IS NOT NULL;

-- ── Backfill: the user never typed this ─────────────────────────────────────
-- Pre-114 user rows were stored with the server's injected context block glued
-- to the front, so the audit trail attributes to the human a sentence the
-- server wrote. Anchored and role-gated so it cannot touch anything else; a
-- question that genuinely began "Current session: ..." is not a real risk, and
-- the replacement is idempotent either way.
UPDATE ai_messages
   SET content = regexp_replace(content, '^Current session: [^\n]*\.\n\n', '')
 WHERE role = 'user'
   AND content LIKE 'Current session: %';

-- ── Room for a fourth surface: the in-app guide ─────────────────────────────
-- ai_conversations.feature is CHECKed to ('ask','remarks','parent'). A global
-- "how do I do this?" assistant is a fourth, and widening the constraint here
-- costs one statement now versus a whole migration later.
--
-- It is a genuinely different surface, not a variant of 'ask': it answers
-- questions about the SOFTWARE, reads no student data at all, and is therefore
-- available to every signed-in user rather than to holders of a data grant.
-- Giving it its own value keeps the two apart in the audit trail and in the
-- chat sidebar, which filters on feature precisely so one surface's history
-- never shows up in another's.
ALTER TABLE ai_conversations DROP CONSTRAINT IF EXISTS ai_conversations_feature_check;
ALTER TABLE ai_conversations
  ADD CONSTRAINT ai_conversations_feature_check
  CHECK (feature IN ('ask', 'remarks', 'parent', 'guide'));

-- ── RLS is unchanged ────────────────────────────────────────────────────────
-- Still enabled with zero policies on all four tables. Reading your own chat
-- history goes through an API route on the service-role client that filters by
-- actor_id, NOT through a policy: ai_conversations is shared across features
-- and channels, so "rows where actor_id = auth.uid()" would also hand a
-- teacher their remark-drafting runs and a parent their WhatsApp session.

COMMENT ON TABLE ai_messages IS
  'RLS enabled with NO policies, intentionally: service-role access only. '
  'CHANGED IN 114: assistant content IS stored, because a chat you cannot '
  'read back is not a chat. This table therefore holds an unstructured '
  'partial copy of student facts — names, counts, and, where the caller '
  'unlocked sensitive columns, quoted contact details. Treat it as student '
  'data for retention, DSAR and breach purposes. Deleting a conversation '
  'NULLs content and stamps redacted_at; the audit skeleton (seq, tokens, '
  'tool calls, query runs) survives, the words do not.';

COMMENT ON TABLE ai_conversations IS
  'RLS enabled with NO policies, intentionally: service-role access only. Any '
  'client credential reads this as empty. Do not add a policy without deciding '
  'what a non-admin should be able to learn about other people''s questions. '
  'Deletion is SOFT (deleted_at): a hard delete would cascade ai_messages and '
  'ai_tool_calls, letting anyone erase the record of what the assistant read '
  'by tidying their chat list.';


-- #####################################################################
-- ### erp/migration-115-day-book-import.sql
-- #####################################################################
-- migration-115-day-book-import.sql
--
-- Backfill support for the previous ERP software's "Day Book Head wise Report":
-- one row per receipt, with head-wise amount columns, the tender type, and the
-- instrument details. Session 2026-27 was collected entirely in that software
-- until this import runs, so until it does every collection figure, dues
-- register and no-dues gate in this ERP is wrong.
--
-- ── Numbering ───────────────────────────────────────────────────────────────
-- 110-113 are a reserved block for the AI feature; 114 is ai_chat_history.
-- 115 is the next free number across every module folder. Re-run the check
-- before adding a file, because parallel branches both grab "next":
--   ls scripts/migrations/*/ | grep -oE 'migration-[0-9]+' | sort | uniq -d
--
--
-- ── Why source_receipt_no, when receipt_number is already UNIQUE ────────────
-- The importer splits one old receipt across the instalments it settles, so a
-- single source receipt becomes 1..N fee_payments rows. The obvious key is a
-- suffixed receipt_number ("DB-2026-1242-1", "-2"), and it is the wrong one:
-- the split depends on the fee schedule at import time. Edit an instalment
-- amount between two imports and the same money re-splits under different
-- suffixes, so the second upload inserts a duplicate set instead of
-- conflicting with the first. On an overlapping re-export -- which is the
-- normal case, since the school re-exports the day book as the year goes on --
-- that silently doubles the collection.
--
-- source_receipt_no records the old software's own receipt number, which never
-- changes. The unique index below is what makes a re-upload idempotent no
-- matter how the schedule moved, and it is scoped by academic year because the
-- old software restarts its receipt series each session.
--
-- COALESCE(fee_structure_id, bus_stop_id) rather than fee_structure_id alone:
-- fee_payments_target_xor (migration 074) means exactly one of the two is set,
-- and a transport day book -- the export that comes next -- lands on
-- bus_stop_id with fee_structure_id NULL. NULLs compare distinct in a unique
-- index, so keying on fee_structure_id would leave those rows undeduplicated.
--
--
-- ── Why import_batches ─────────────────────────────────────────────────────
-- Batch tracking today is a bare import_batch_id uuid on fee_payments, results
-- and student_enrollments, minted at commit and shown once in a toast. Nothing
-- records what the batch was, who ran it or whether it was reverted, and the
-- two revert endpoints have no UI because there is nowhere to list batches
-- from. That was survivable for a one-shot backfill of a closed year. It is
-- not survivable for a ledger that will be re-imported repeatedly through a
-- live session and holds two crore rupees.
--
-- Deliberately NOT an FK from fee_payments.import_batch_id: rows already
-- carrying batch ids have no parent, and ON DELETE semantics would then decide
-- the fate of receipts. The backfill at the end of this file gives the
-- existing batches a parent row so the history list is not blank on day one,
-- but the column stays a plain indexed uuid -- the same shape results and
-- student_enrollments already use.

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. fee_payments.source_receipt_no
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE fee_payments
  ADD COLUMN IF NOT EXISTS source_receipt_no text;

COMMENT ON COLUMN fee_payments.source_receipt_no IS
  'Receipt number as printed by the previous ERP software. Stable across '
  're-imports (unlike receipt_number, whose slice suffix moves when the fee '
  'schedule changes), so it is the idempotency key for the day-book importer '
  'and the number the office searches by.';

CREATE UNIQUE INDEX IF NOT EXISTS fee_payments_source_receipt_unique
  ON fee_payments (
    academic_year_id,
    source_receipt_no,
    COALESCE(fee_structure_id, bus_stop_id)
  )
  WHERE source_receipt_no IS NOT NULL;

-- Lookup path for "show me old receipt 1242" and for the dry run's
-- already-imported classification, which probes by year + receipt number.
-- The Day Book records one instrument date for every non-cash receipt: the
-- date on the cheque, or the date the online transfer went through. Both land
-- in cheque_date, so widen what the column claims to mean. Nothing reads it as
-- cheque-only -- the receipt PDF prints it beside whichever reference the row
-- carries.
COMMENT ON COLUMN fee_payments.cheque_date IS
  'Date on the payment instrument: the date written on the cheque, or the '
  'date an online transfer/UTR was executed. Often differs from payment_date, '
  'which is always the date the school received the money.';

CREATE INDEX IF NOT EXISTS idx_fee_payments_source_receipt
  ON fee_payments (academic_year_id, source_receipt_no)
  WHERE source_receipt_no IS NOT NULL;

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. import_batches
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS import_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- What kind of file produced this batch. Determines which table the revert
  -- endpoint deletes from, so it is a CHECK rather than free text.
  kind text NOT NULL CHECK (kind IN (
    'fees_day_book',
    'fees_account_wise',
    'results_greensheet',
    'students_backfill'
  )),

  academic_year_id uuid REFERENCES academic_years(id) ON DELETE SET NULL,

  file_name        text,
  file_size_bytes  integer CHECK (file_size_bytes IS NULL OR file_size_bytes >= 0),

  -- The period the source report itself covers, parsed from its title line.
  -- Two exports of overlapping periods are the expected case; this is what
  -- lets an admin see that at a glance.
  source_period_start date,
  source_period_end   date,

  row_count      integer NOT NULL DEFAULT 0 CHECK (row_count >= 0),
  created_count  integer NOT NULL DEFAULT 0 CHECK (created_count >= 0),
  skipped_count  integer NOT NULL DEFAULT 0 CHECK (skipped_count >= 0),
  amount_total   numeric(14, 2),

  -- The source file's own footer totals plus what we actually wrote, kept
  -- together so a reconciliation can be re-read months later without the
  -- original spreadsheet.
  control_totals jsonb,

  notes      text,
  created_by uuid REFERENCES profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),

  reverted_at timestamptz,
  reverted_by uuid REFERENCES profiles(id) ON DELETE SET NULL,

  CONSTRAINT import_batches_revert_consistent CHECK (
    (reverted_at IS NULL AND reverted_by IS NULL)
    OR reverted_at IS NOT NULL
  ),

  CONSTRAINT import_batches_period_ordered CHECK (
    source_period_start IS NULL
    OR source_period_end IS NULL
    OR source_period_end >= source_period_start
  )
);

CREATE INDEX IF NOT EXISTS idx_import_batches_kind_created
  ON import_batches (kind, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_import_batches_academic_year
  ON import_batches (academic_year_id);

CREATE INDEX IF NOT EXISTS idx_import_batches_created_by
  ON import_batches (created_by);

CREATE INDEX IF NOT EXISTS idx_import_batches_reverted_by
  ON import_batches (reverted_by);

-- Admin-only. Editors with the 'fees' grant may run an import (the API gates
-- that with verifyAdminOrEditor), but the batch registry is the audit trail
-- for it and reverting is admin-only, so nothing below service role reads or
-- writes this table directly.
ALTER TABLE import_batches ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins have full access to import batches" ON import_batches;
CREATE POLICY "Admins have full access to import batches"
  ON import_batches FOR ALL
  USING (public.get_user_role() = 'admin')
  WITH CHECK (public.get_user_role() = 'admin');

-- ═══════════════════════════════════════════════════════════════════════════
-- 3. Backfill parents for batches that already exist
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Counts and totals are recomputed from the rows themselves. file_name and
-- created_at are unknowable after the fact: created_at falls back to the
-- earliest row's created_at, which is the commit moment to within a second.

INSERT INTO import_batches (
  id, kind, academic_year_id, row_count, created_count, amount_total,
  notes, created_by, created_at
)
-- (array_agg(...))[1] rather than min(): min/max are declared per type in
-- pg_aggregate and uuid is not somewhere to rely on that. This also picks the
-- FIRST row of the batch, which is what "the year this batch ran against"
-- actually means, where min() would have picked the lowest uuid.
SELECT
  fp.import_batch_id,
  'fees_account_wise',
  (array_agg(fp.academic_year_id ORDER BY fp.created_at))[1],
  COUNT(*),
  COUNT(*),
  SUM(fp.amount_paid),
  'Reconstructed by migration 115 from the payment rows. The original file '
    || 'name and exact commit time were never recorded.',
  (array_agg(fp.recorded_by ORDER BY fp.created_at))[1],
  COALESCE(MIN(fp.created_at), now())
FROM fee_payments fp
WHERE fp.import_batch_id IS NOT NULL
  AND fp.source = 'historical_import'
GROUP BY fp.import_batch_id
ON CONFLICT (id) DO NOTHING;

INSERT INTO import_batches (
  id, kind, academic_year_id, row_count, created_count, notes, created_at
)
-- `results` carries no academic_year_id of its own; the year hangs off the
-- exam type the marks were entered against.
SELECT
  r.import_batch_id,
  'results_greensheet',
  (array_agg(et.academic_year_id ORDER BY r.created_at))[1],
  COUNT(*),
  COUNT(*),
  'Reconstructed by migration 115 from the result rows. The original file '
    || 'name and exact commit time were never recorded.',
  COALESCE(MIN(r.created_at), now())
FROM results r
JOIN exam_types et ON et.id = r.exam_type_id
WHERE r.import_batch_id IS NOT NULL
  AND r.source = 'historical_import'
GROUP BY r.import_batch_id
ON CONFLICT (id) DO NOTHING;

INSERT INTO import_batches (
  id, kind, academic_year_id, row_count, created_count, notes, created_at
)
SELECT
  se.import_batch_id,
  'students_backfill',
  (array_agg(se.academic_year_id ORDER BY se.created_at))[1],
  COUNT(*),
  COUNT(*),
  'Reconstructed by migration 115 from the enrollment rows. The original '
    || 'file name and exact commit time were never recorded.',
  COALESCE(MIN(se.created_at), now())
FROM student_enrollments se
WHERE se.import_batch_id IS NOT NULL
  -- Only the student bulk importer's own batches. Enrollments tagged
  -- 'historical_import' were created by the results importer and share its
  -- batch id, which the previous statement has already registered.
  AND se.source = 'bulk_backfill'
GROUP BY se.import_batch_id
ON CONFLICT (id) DO NOTHING;


-- #####################################################################
-- ### erp/migration-116-teacher-lifecycle.sql
-- #####################################################################
-- Migration 116 — teacher lifecycle: retire a teacher instead of orphaning one.
--
-- ── The bug this exists to close ────────────────────────────────────────────
-- `staff_members` (the public staff listing) and `teachers` (the ERP entity)
-- are two rows joined by `teachers.staff_member_id … ON DELETE SET NULL`.
--
--   DELETE /api/staff  hard-deletes the staff row. Postgres nulls the link.
--                      The teacher row survives with is_active = true.
--   PATCH  /api/staff  with is_active=false hides the staff row from the Staff
--                      page (it filters is_active) but never touches the
--                      teacher row either.
--
-- Either way the teacher stays active in a table no ERP screen can edit — so
-- departed staff keep appearing in every teacher dropdown. Every one of those
-- dropdowns already filters `.eq("is_active", true)` correctly; the DATA is
-- wrong, not the query. Three teachers were reported by name; this migration
-- adds the columns and the diagnostic to find the rest.
--
-- ── Why no data change here ─────────────────────────────────────────────────
-- Retiring the existing ghosts is deliberately NOT done in SQL. `is_active`
-- also gates who can be picked for a substitution and who shows in the staff
-- roster, and a heuristic sweep would be a silent bulk edit of live records
-- with no audit trail and no way to tell a genuine departure from a teacher
-- who simply has no staff row yet. The view below surfaces the candidates;
-- an admin retires them one at a time on /people/teachers, which records a
-- date and is reversible.
--
-- SAFE TO RE-RUN.

BEGIN;

-- ─── 1. Lifecycle columns ───────────────────────────────────────────────────

ALTER TABLE teachers
  ADD COLUMN IF NOT EXISTS date_of_leaving date,
  ADD COLUMN IF NOT EXISTS leaving_reason  text;

COMMENT ON COLUMN teachers.date_of_leaving IS
  'Date the teacher left the school. Set when is_active flips to false; kept '
  'when they are reactivated so a rejoin is visible in the record.';
COMMENT ON COLUMN teachers.leaving_reason IS
  'Free-text note on why the teacher was retired (resigned, transferred, …).';

-- ─── 2. Index the dropdown query ────────────────────────────────────────────
-- Every teacher select in the app is `WHERE is_active ORDER BY full_name`.
-- Partial, because nothing lists the inactive ones in bulk except the new
-- People → Teachers page, which is admin-only and low-traffic.

CREATE INDEX IF NOT EXISTS idx_teachers_active_name
  ON teachers(full_name) WHERE is_active;

-- ─── 3. The diagnostic ──────────────────────────────────────────────────────
-- A teacher row that is still active but has no staff record AND no portal
-- login is, with high probability, someone who left and was deleted from
-- People → Staff. "High probability", not certainty: a teacher created
-- directly (bulk import, migration 081 backfill) and never linked looks
-- identical. Hence a review queue, not an auto-deactivate.

CREATE OR REPLACE VIEW public.teachers_needing_review AS
  SELECT t.id,
         t.employee_id,
         t.full_name,
         t.email,
         t.phone,
         t.date_of_joining,
         t.created_at,
         -- What retiring them would leave dangling, so the page can warn
         -- before the admin commits.
         (SELECT count(*) FROM public.timetable_periods tp WHERE tp.teacher_id = t.id)
           AS timetable_period_count,
         (SELECT count(*) FROM public.class_subjects cs   WHERE cs.teacher_id = t.id)
           AS class_subject_count,
         (SELECT count(*) FROM public.classes c    WHERE c.class_teacher_id = t.id)
           AS class_teacher_count
  FROM public.teachers t
  WHERE t.is_active
    AND t.staff_member_id IS NULL
    AND NOT EXISTS (
      SELECT 1 FROM public.profiles p WHERE p.teacher_id = t.id
    );

COMMENT ON VIEW public.teachers_needing_review IS
  'Active teacher records with no linked staff_members row and no portal '
  'profile — the shape left behind when a staff member is deleted from '
  'People → Staff (teachers.staff_member_id is ON DELETE SET NULL). Review '
  'queue for /people/teachers; retiring is an explicit admin action, never '
  'automatic.';

COMMIT;


-- #####################################################################
-- ### erp/migration-117-teacher-subjects.sql
-- #####################################################################
-- Migration 117 — which subjects each teacher is qualified to teach.
--
-- ── Why ─────────────────────────────────────────────────────────────────────
-- Assigning Mathematics to VI-B today offers a dropdown of every teacher in
-- the school. The staff asked for the three maths teachers instead, and
-- correctly identified the missing piece: "this picture will be unlocked only
-- after one new option of subject assign to teachers." This table is that
-- option. Phase 3 is what turns it into the filtered dropdown.
--
-- ── Why not reuse class_subjects ────────────────────────────────────────────
-- class_subjects answers "who teaches Maths to VI-B" — one teacher per
-- (class, subject), scoped to a class. Competency is neither: a teacher can
-- know a subject they are not currently timetabled for, and three of them can
-- know the same one. Different question, different table.
--
-- SAFE TO RE-RUN.

BEGIN;

-- ─── 1. The table ───────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS teacher_subjects (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  teacher_id uuid REFERENCES teachers(id) ON DELETE CASCADE NOT NULL,
  subject_id uuid REFERENCES subjects(id) ON DELETE CASCADE NOT NULL,
  created_at timestamptz DEFAULT now(),
  UNIQUE(teacher_id, subject_id)
);

COMMENT ON TABLE teacher_subjects IS
  'Which subjects a teacher is qualified to teach. Drives the "teachers of '
  'this subject first" ordering in the assign-subject dropdown. Distinct from '
  'class_subjects, which records who actually teaches a subject in one class.';

CREATE INDEX IF NOT EXISTS idx_teacher_subjects_teacher
  ON teacher_subjects(teacher_id);
CREATE INDEX IF NOT EXISTS idx_teacher_subjects_subject
  ON teacher_subjects(subject_id);

-- ─── 2. RLS ─────────────────────────────────────────────────────────────────
-- Authenticated read, NOT the `USING (true)` with no TO clause that
-- class_subjects and stream_subjects carry. Those are keyed on class / stream
-- / subject and contain no person. This table is keyed on teacher_id, so an
-- anon read would enumerate every teacher UUID in the school — the same shape
-- of leak migration 098 was written to close on `teachers` itself.
-- student_subjects sets the precedent for the person-keyed case.
--
-- Writes are admin-only here; editors reach the table through the admin proxy,
-- which gates on the `subjects` feature key. Same arrangement as
-- class_subjects and stream_subjects.

ALTER TABLE teacher_subjects ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated can read teacher_subjects" ON teacher_subjects;
CREATE POLICY "Authenticated can read teacher_subjects"
  ON teacher_subjects FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS "Admins manage teacher_subjects" ON teacher_subjects;
CREATE POLICY "Admins manage teacher_subjects"
  ON teacher_subjects FOR ALL
  USING (public.get_user_role() = 'admin')
  WITH CHECK (public.get_user_role() = 'admin');

-- ─── 3. Seed from what the system already knows ─────────────────────────────
-- Both sources are needed. api/substitutions/suggest reads both for exactly
-- this reason and says why: "in practice class_subjects.teacher_id is often
-- unpopulated — teachers are assigned via the timetable instead". Seeding from
-- class_subjects alone would leave much of the staff with no subjects at all,
-- and the filtered dropdown would filter nothing.
--
-- NOT seeded from staff_members.subject. It is free text holding things like
-- 'Biology', 'Principal' and 'Mother Teacher'; name-matching it against the
-- subject catalogue would invent competencies that quietly mis-filter the
-- dropdown. A missing entry an admin can tick is better than a wrong one
-- nobody notices.

INSERT INTO teacher_subjects (teacher_id, subject_id)
SELECT DISTINCT cs.teacher_id, cs.subject_id
FROM class_subjects cs
WHERE cs.teacher_id IS NOT NULL
ON CONFLICT (teacher_id, subject_id) DO NOTHING;

INSERT INTO teacher_subjects (teacher_id, subject_id)
SELECT DISTINCT tp.teacher_id, tp.subject_id
FROM timetable_periods tp
WHERE tp.teacher_id IS NOT NULL
  AND tp.subject_id IS NOT NULL
  AND tp.is_break IS NOT TRUE
ON CONFLICT (teacher_id, subject_id) DO NOTHING;

-- ─── 4. Keep it current ─────────────────────────────────────────────────────
-- class_subjects.teacher_id is written from at least five places (the Assign
-- dialog, the Change-Teacher dialog, /api/subjects/bulk-assign,
-- /api/subjects/quick-setup, and the class-assignments route added in the next
-- phase), and adminApi() is a single-table proxy that cannot carry a side
-- effect. So the rule lives here, where every writer passes through it.
--
-- Add-only, on purpose. Un-assigning a teacher from VI-B Maths does not mean
-- they stopped knowing Maths, and a delete-side trigger would also erase
-- competencies an admin ticked by hand.
--
-- Deliberately not on timetable_periods: that table is used for the one-time
-- seed above but not for ongoing learning. Its shape changes later in this
-- work, and a trigger there would buy a little accuracy for real risk.

CREATE OR REPLACE FUNCTION public.trg_learn_teacher_subject()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.subject_id IS NOT NULL THEN
    INSERT INTO public.teacher_subjects (teacher_id, subject_id)
    VALUES (NEW.teacher_id, NEW.subject_id)
    ON CONFLICT (teacher_id, subject_id) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS class_subject_learns_teacher_subject ON class_subjects;
CREATE TRIGGER class_subject_learns_teacher_subject
  AFTER INSERT OR UPDATE OF teacher_id ON class_subjects
  FOR EACH ROW
  WHEN (NEW.teacher_id IS NOT NULL)
  EXECUTE FUNCTION public.trg_learn_teacher_subject();

COMMIT;


-- #####################################################################
-- ### erp/migration-118-stream-wings.sql
-- #####################################################################
-- Migration 118 — wings: a reusable class band with its own subject set.
--
-- ── What a wing is ──────────────────────────────────────────────────────────
-- The school groups classes into wings — Pre-Primary, Primary (I–V), Middle
-- (VI–VIII), Senior (IX–XII). It already thinks this way: staff_members.category
-- carries prePrimaryCoordinator / primaryCoordinator / middleCoordinator /
-- seniorCoordinator.
--
-- The ask: define "Middle Wing = classes VI–VIII, these 11 subjects" once, then
-- press a button and have those subjects allotted to every class AND section in
-- the band — instead of repeating the work nine times for VI-A/B/C, VII-A/B/C,
-- VIII-A/B/C.
--
-- ── Why on `streams` rather than a new table ────────────────────────────────
-- The admin had already built "Middle Wing" on the Streams tab, because a
-- stream is the only thing in the ERP that owns a set of subjects
-- (stream_subjects). Reusing the table keeps that profile and its subject
-- picks, and lets the existing "Manage subjects" dialog serve both.
--
-- ── The danger, and the guard ───────────────────────────────────────────────
-- A stream is NOT just a label. classes.stream_id, student_enrollments.stream_id
-- and fee_structures.stream_id all read it, and fee resolution keys off it. A
-- wing loose in that machinery would change what students are charged.
--
-- So `kind` is a hard discriminator, and wings carry their band in `class_names`
-- rather than ever being attached to classes.stream_id. Every picker and every
-- importer name-lookup filters to kind='stream'; the two places that resolve a
-- STORED stream_id back to a name are deliberately left unfiltered, so a stored
-- id always renders.
--
-- SAFE TO RE-RUN.

BEGIN;

ALTER TABLE streams
  ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'stream',
  -- Class NAMES, not class ids: classes are per-academic-year rows, and a wing
  -- has to outlive the year rollover. Values come from CLASS_ORDER in
  -- packages/shared/src/lib/constants.ts — 'Nursery','LKG','UKG','I'…'XII' —
  -- so Middle Wing is {'VI','VII','VIII'}.
  ADD COLUMN IF NOT EXISTS class_names text[] NOT NULL DEFAULT '{}';

-- Added separately so the migration is re-runnable: ADD COLUMN IF NOT EXISTS
-- skips the column on a second run, and would skip an inline CHECK with it.
ALTER TABLE streams DROP CONSTRAINT IF EXISTS streams_kind_check;
ALTER TABLE streams
  ADD CONSTRAINT streams_kind_check CHECK (kind IN ('stream', 'wing'));

COMMENT ON COLUMN streams.kind IS
  'stream = an academic stream for XI/XII (Science, Commerce, Humanities), the '
  'original meaning: attachable to classes.stream_id and read by fee '
  'resolution. wing = a band of classes with a shared subject set, used only to '
  'push subjects onto classes. Wings are filtered out of every stream picker '
  'and every importer name-lookup.';
COMMENT ON COLUMN streams.class_names IS
  'For kind=wing: the class names the wing covers, e.g. {VI,VII,VIII}. Names '
  'rather than class ids so the wing survives the academic-year rollover. '
  'Always empty for kind=stream.';

-- Every existing row is an academic stream with no band, so XI/XII behaviour is
-- byte-identical the moment this lands. The defaults already do this; the
-- UPDATE is here only for a row that predates the NOT NULL default somehow.
UPDATE streams SET kind = 'stream' WHERE kind IS NULL;

-- Pickers filter on kind, and there are few streams, but the index costs
-- nothing and makes the intent legible in the catalog.
CREATE INDEX IF NOT EXISTS idx_streams_kind ON streams(kind);

COMMIT;


-- #####################################################################
-- ### erp/migration-119-timetable-period-groups.sql
-- #####################################################################
-- Migration 119 — parallel teaching groups in one timetable period.
--
-- ── What the school asked for ───────────────────────────────────────────────
-- "In games period there are two or more teachers in the field along with
-- students of different classes as well as of different interests… three
-- different groups are made — basketball students from class 6 to 7, and
-- similar two more groups as badminton and cricket. Is it possible to fix
-- multiple teachers names in one column of games of different classes."
--
-- And the same shape again in XI/XII: "optional subjects 5 and 6 are taken by
-- two different teachers in a particular period — I.P. and P.Ed., Music and
-- Painting, Biology and Mathematics."
--
-- One cell, several parallel (subject, teacher, group) tracks.
--
-- ── Why a row per group, not a child table ──────────────────────────────────
-- The obvious design is a child table hanging off the period. It was designed,
-- audited against every consumer, and rejected: a co-teacher living in a child
-- table is invisible to every `.eq("teacher_id", …)` query in the ERP, and
-- there are twelve. Until each is rewritten the failures are silent —
-- api/teacher-absences returns "no affected periods" for an absent co-teacher
-- so no substitute is ever arranged; substitution-availability green-lights a
-- substitute who is genuinely double-booked; the substitution sheet maps one
-- teacher per period and drops the second.
--
-- Making each group its own row means teacher_id is already per-group, and all
-- of that keeps working as written.
--
-- ── The shared-activity escape ──────────────────────────────────────────────
-- Migration 071 added an exclusion constraint: a teacher cannot occupy two
-- time-overlapping periods on the same weekday. That is exactly right for
-- ordinary teaching and exactly wrong for games — the basketball coach IS on
-- the field for VI-A, VI-B, VII-A and VII-B at once, which is four overlapping
-- rows. `is_shared` marks a cell as a combined activity and exempts it. It is a
-- deliberate per-cell admin choice, ordinary cells keep the hard guarantee, and
-- the companion view below keeps what the constraint no longer blocks visible.
--
-- SAFE TO RE-RUN.

BEGIN;

-- Every object below is public-qualified, and the path is pinned as well: a
-- session whose search_path puts another schema first would otherwise add the
-- columns to a different table of the same name, and the migration would
-- report success while the app still saw nothing. (Diagnosed the hard way.)
SET LOCAL search_path = public;

-- ─── 1. The columns ─────────────────────────────────────────────────────────

ALTER TABLE public.timetable_periods
  ADD COLUMN IF NOT EXISTS group_no    smallint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS group_label text,
  ADD COLUMN IF NOT EXISTS is_shared   boolean  NOT NULL DEFAULT false;

COMMENT ON COLUMN public.timetable_periods.group_no IS
  'Which parallel track within the cell. 0 is the primary group — every row '
  'that existed before migration 119 is one — and 1,2,… are the extra groups '
  'that make a Games or optional-subject period.';
COMMENT ON COLUMN public.timetable_periods.group_label IS
  'What this group actually is, when the subject does not say it: '
  '"Basketball", "Badminton", "Cricket".';
COMMENT ON COLUMN public.timetable_periods.is_shared IS
  'A combined activity running across several classes at once. Exempts the row '
  'from the teacher double-booking constraint, because a games coach genuinely '
  'is with four classes simultaneously.';

-- ─── 2. One row per cell becomes one row per (cell, group) ──────────────────
-- The old constraint was declared inline as UNIQUE(...), so Postgres auto-named
-- it. Find it by its COLUMNS rather than trusting a spelling.

DO $$
DECLARE c text;
BEGIN
  SELECT con.conname INTO c
  FROM pg_constraint con
  WHERE con.conrelid = 'public.timetable_periods'::regclass
    AND con.contype = 'u'
    AND (SELECT array_agg(att.attname::text ORDER BY att.attname)
         FROM unnest(con.conkey) k
         JOIN pg_attribute att
           ON att.attrelid = con.conrelid AND att.attnum = k)
        = ARRAY['class_id','day_of_week','period_number'];
  IF c IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.timetable_periods DROP CONSTRAINT %I', c);
  END IF;
END $$;

ALTER TABLE public.timetable_periods
  DROP CONSTRAINT IF EXISTS timetable_periods_cell_group_key;
ALTER TABLE public.timetable_periods
  ADD CONSTRAINT timetable_periods_cell_group_key
  UNIQUE (class_id, day_of_week, period_number, group_no);

-- …but still exactly one PRIMARY group per cell, so the old invariant survives
-- for every reader that assumes a cell has one main row.
CREATE UNIQUE INDEX IF NOT EXISTS timetable_periods_primary_group_uniq
  ON public.timetable_periods(class_id, day_of_week, period_number)
  WHERE group_no = 0;

-- ─── 3. Let a shared activity span classes ──────────────────────────────────
-- Migration 071's constraint, re-stated with the is_shared exemption. Rebuilt
-- rather than altered because a predicate cannot be changed in place.

CREATE EXTENSION IF NOT EXISTS btree_gist;

ALTER TABLE public.timetable_periods
  DROP CONSTRAINT IF EXISTS timetable_teacher_no_overlap;
ALTER TABLE public.timetable_periods
  ADD CONSTRAINT timetable_teacher_no_overlap
  EXCLUDE USING gist (
    teacher_id WITH =,
    day_of_week WITH =,
    tsrange('2000-01-01'::date + start_time, '2000-01-01'::date + end_time) WITH &&
  ) WHERE (
    teacher_id IS NOT NULL
    AND is_break IS NOT TRUE
    AND start_time < end_time
    AND is_shared IS NOT TRUE
  );

-- ─── 4. Keep the exempted clashes visible ───────────────────────────────────
-- What the constraint no longer blocks is not thereby fine — it is just
-- deliberate. This view is how an admin checks that every remaining overlap is
-- one they meant.

CREATE OR REPLACE VIEW public.timetable_teacher_clashes AS
  SELECT a.teacher_id,
         t.full_name        AS teacher_name,
         a.day_of_week,
         a.id               AS period_a,
         ca.name || '-' || ca.section AS class_a,
         a.start_time       AS a_start,
         a.end_time         AS a_end,
         a.is_shared        AS a_shared,
         b.id               AS period_b,
         cb.name || '-' || cb.section AS class_b,
         b.start_time       AS b_start,
         b.end_time         AS b_end,
         b.is_shared        AS b_shared
  FROM public.timetable_periods a
  JOIN public.timetable_periods b
    ON a.teacher_id = b.teacher_id
   AND a.day_of_week = b.day_of_week
   AND a.id < b.id
  LEFT JOIN public.teachers t  ON t.id  = a.teacher_id
  LEFT JOIN public.classes  ca ON ca.id = a.class_id
  LEFT JOIN public.classes  cb ON cb.id = b.class_id
  WHERE a.teacher_id IS NOT NULL
    AND a.is_break IS NOT TRUE AND b.is_break IS NOT TRUE
    AND a.start_time < b.end_time
    AND a.end_time > b.start_time;

-- A view runs with its OWNER's rights, so it is not held back by the RLS on
-- timetable_periods and teachers. Both diagnostics below are keyed on a
-- teacher and would enumerate staff UUIDs, so say who may read them rather
-- than inheriting whatever the schema's default grants happen to be — the
-- leak migration 098 was written to close. Neither is read by app code; they
-- are for an admin querying the database.
REVOKE ALL ON public.timetable_teacher_clashes FROM PUBLIC, anon;
GRANT SELECT ON public.timetable_teacher_clashes TO authenticated;

COMMENT ON VIEW public.timetable_teacher_clashes IS
  'Teachers occupying two time-overlapping periods on one weekday. The DB '
  'constraint blocks these unless a row is marked is_shared, so in a healthy '
  'timetable every row here is an intentional combined activity. A row where '
  'neither side is shared is a bug.';

-- ─── 5. Stop the drift view crying wolf ─────────────────────────────────────
-- class_subjects holds ONE canonical teacher per (class, subject), so Games
-- VI-A taught by three coaches would leave two of them permanently reported as
-- drift. Only the primary group is comparable against the canonical assignment.

CREATE OR REPLACE VIEW public.timetable_assignment_drift AS
  SELECT tp.id              AS timetable_period_id,
         tp.class_id,
         c.name             AS class_name,
         c.section          AS class_section,
         tp.subject_id,
         s.name             AS subject_name,
         tp.day_of_week,
         tp.period_number,
         tp.teacher_id      AS timetable_teacher_id,
         tt.full_name       AS timetable_teacher_name,
         cs.teacher_id      AS canonical_teacher_id,
         ct.full_name       AS canonical_teacher_name
  FROM public.timetable_periods tp
  JOIN public.class_subjects cs
    ON cs.class_id = tp.class_id AND cs.subject_id = tp.subject_id
  LEFT JOIN public.classes  c  ON c.id  = tp.class_id
  LEFT JOIN public.subjects s  ON s.id  = tp.subject_id
  LEFT JOIN public.teachers tt ON tt.id = tp.teacher_id
  LEFT JOIN public.teachers ct ON ct.id = cs.teacher_id
  WHERE tp.is_break IS NOT TRUE
    -- migration 119: groups 1..n are parallel tracks with their own teachers.
    -- They differ from the canonical assignment by design, not by drift.
    AND tp.group_no = 0
    AND tp.teacher_id IS DISTINCT FROM cs.teacher_id;

REVOKE ALL ON public.timetable_assignment_drift FROM PUBLIC, anon;
GRANT SELECT ON public.timetable_assignment_drift TO authenticated;

COMMENT ON VIEW public.timetable_assignment_drift IS
  'Timetable periods whose teacher differs from the canonical class_subjects '
  'assignment for the same (class, subject). class_subjects is authoritative '
  '(migration 069); rows here are drift to reconcile (or legitimate cover). '
  'Only primary groups are compared — parallel groups (migration 119) have '
  'their own teachers by design.';

COMMIT;


-- #####################################################################
-- ### erp/migration-120-clash-view-section-fix.sql
-- #####################################################################
-- Migration 120 — a section-less class must not vanish from the clash view.
--
-- migration-119 built timetable_teacher_clashes with
--
--     ca.name || '-' || ca.section AS class_a
--
-- and `classes.section` is nullable. In SQL, 'VII' || '-' || NULL is NULL, so
-- any class without a section reports its label as blank — on the one screen
-- an admin opens to find out WHICH classes a teacher is double-booked across.
-- The rest of the codebase has always written this as
-- `${name}${section ? "-" + section : ""}`; this brings the view in line.
--
-- View body is otherwise unchanged from 119.
--
-- SAFE TO RE-RUN.

BEGIN;

-- Migration 119 must be in first — this view reads timetable_periods.is_shared,
-- which 119 adds. Without this guard you get a bare
-- "column a.is_shared does not exist", which names the symptom and not the
-- cause. 119 is wrapped in its own transaction, so if it errored anywhere it
-- rolled back completely and left none of its columns behind.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name   = 'timetable_periods'
       AND column_name  = 'is_shared'
  ) THEN
    RAISE EXCEPTION
      'migration 120 needs migration 119 first: timetable_periods.is_shared is missing. Apply migration-119-timetable-period-groups.sql, then re-run this.';
  END IF;
END $$;

CREATE OR REPLACE VIEW public.timetable_teacher_clashes AS
  SELECT a.teacher_id,
         t.full_name        AS teacher_name,
         a.day_of_week,
         a.id               AS period_a,
         ca.name || COALESCE('-' || ca.section, '') AS class_a,
         a.start_time       AS a_start,
         a.end_time         AS a_end,
         a.is_shared        AS a_shared,
         b.id               AS period_b,
         cb.name || COALESCE('-' || cb.section, '') AS class_b,
         b.start_time       AS b_start,
         b.end_time         AS b_end,
         b.is_shared        AS b_shared
  FROM public.timetable_periods a
  JOIN public.timetable_periods b
    ON a.teacher_id = b.teacher_id
   AND a.day_of_week = b.day_of_week
   AND a.id < b.id
  LEFT JOIN public.teachers t  ON t.id  = a.teacher_id
  LEFT JOIN public.classes  ca ON ca.id = a.class_id
  LEFT JOIN public.classes  cb ON cb.id = b.class_id
  WHERE a.teacher_id IS NOT NULL
    AND a.is_break IS NOT TRUE AND b.is_break IS NOT TRUE
    AND a.start_time < b.end_time
    AND a.end_time > b.start_time;

-- CREATE OR REPLACE keeps existing grants, but restate them so a database that
-- somehow missed 119's grants still ends up correct.
REVOKE ALL ON public.timetable_teacher_clashes FROM PUBLIC, anon;
GRANT SELECT ON public.timetable_teacher_clashes TO authenticated;

COMMENT ON VIEW public.timetable_teacher_clashes IS
  'Teachers occupying two time-overlapping periods on one weekday. The DB '
  'constraint blocks these unless a row is marked is_shared, so in a healthy '
  'timetable every row here is an intentional combined activity. A row where '
  'neither side is shared is a bug. Surfaced at /timetable/clashes.';

COMMIT;


-- #####################################################################
-- ### erp/migration-121-correlate-marks-rls.sql
-- #####################################################################
-- Migration 121 — a teacher may write marks only for a class-subject they hold.
--
-- ── The hole ────────────────────────────────────────────────────────────────
-- Seven policies gate a teacher writing marks, and each pairs two clauses that
-- are never tied to each other:
--
--     AND class_id   IN (SELECT public.get_my_class_ids())
--     AND subject_id IN (SELECT subject_id FROM class_subjects
--                        WHERE teacher_id = public.get_my_teacher_id())
--
-- The first means "a class I teach something in". The second means "a subject I
-- teach SOMEWHERE". Nothing requires them to be the same assignment. So a
-- teacher who takes Maths in VI-A and Games in VII-B satisfies both for Games
-- marks in VI-A — a pairing they do not teach and nobody intended.
--
-- Not reachable through the app: every write to results, class_tests and
-- class_test_results goes through a server route, and those routes already call
-- teacherTeachesClassSubject(), which correlates properly. RLS is the backstop
-- for a hand-crafted PostgREST call carrying a teacher's own token, which is
-- exactly the case it exists to cover.
--
-- Parallel groups (migration 119) widen it in practice rather than causing it:
-- every additional coach who gains a class_subjects row gains another subject
-- in that second clause.
--
-- ── The fix ─────────────────────────────────────────────────────────────────
-- One correlated EXISTS in place of the two loose IN clauses. The class term is
-- no longer needed separately — a matching class_subjects row proves both
-- halves at once, and proves they belong together.
--
-- SELECT policies are deliberately untouched: a teacher may still READ
-- everything for a class they teach in, which is what the mark-entry screens
-- load. Only the write side narrows.
--
-- This REMOVES access, so it was checked against a scratch Postgres before
-- shipping — see the migration's companion notes in the phase commit.
--
-- Depends on nothing from 118/119/120 — it only rewrites RLS policies over
-- class_subjects, results, class_tests and class_test_results, all of which
-- long predate this work. It can be applied on its own, in any order.
--
-- SAFE TO RE-RUN.

BEGIN;

-- ── results ─────────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "Teachers can insert results for their class-subject combos" ON results;
CREATE POLICY "Teachers can insert results for their class-subject combos"
  ON results FOR INSERT
  WITH CHECK (
    public.get_user_role() = 'teacher'
    AND EXISTS (
      SELECT 1 FROM public.class_subjects cs
       WHERE cs.class_id   = results.class_id
         AND cs.subject_id = results.subject_id
         AND cs.teacher_id = public.get_my_teacher_id()
    )
  );

DROP POLICY IF EXISTS "Teachers can update results for their class-subject combos" ON results;
CREATE POLICY "Teachers can update results for their class-subject combos"
  ON results FOR UPDATE
  USING (
    public.get_user_role() = 'teacher'
    AND EXISTS (
      SELECT 1 FROM public.class_subjects cs
       WHERE cs.class_id   = results.class_id
         AND cs.subject_id = results.subject_id
         AND cs.teacher_id = public.get_my_teacher_id()
    )
  );

-- ── class_tests ─────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "Teachers can insert class_tests for their class-subject combos" ON class_tests;
CREATE POLICY "Teachers can insert class_tests for their class-subject combos"
  ON class_tests FOR INSERT
  WITH CHECK (
    public.get_user_role() = 'teacher'
    AND EXISTS (
      SELECT 1 FROM public.class_subjects cs
       WHERE cs.class_id   = class_tests.class_id
         AND cs.subject_id = class_tests.subject_id
         AND cs.teacher_id = public.get_my_teacher_id()
    )
  );

DROP POLICY IF EXISTS "Teachers can update class_tests for their class-subject combos" ON class_tests;
CREATE POLICY "Teachers can update class_tests for their class-subject combos"
  ON class_tests FOR UPDATE
  USING (
    public.get_user_role() = 'teacher'
    AND EXISTS (
      SELECT 1 FROM public.class_subjects cs
       WHERE cs.class_id   = class_tests.class_id
         AND cs.subject_id = class_tests.subject_id
         AND cs.teacher_id = public.get_my_teacher_id()
    )
  );

DROP POLICY IF EXISTS "Teachers can delete class_tests for their class-subject combos" ON class_tests;
CREATE POLICY "Teachers can delete class_tests for their class-subject combos"
  ON class_tests FOR DELETE
  USING (
    public.get_user_role() = 'teacher'
    AND EXISTS (
      SELECT 1 FROM public.class_subjects cs
       WHERE cs.class_id   = class_tests.class_id
         AND cs.subject_id = class_tests.subject_id
         AND cs.teacher_id = public.get_my_teacher_id()
    )
  );

-- ── class_test_results ──────────────────────────────────────────────────────
-- Keyed through the parent test, so the EXISTS correlates on ITS columns.

DROP POLICY IF EXISTS "Teachers can insert class_test_results for their class-subject combos" ON class_test_results;
CREATE POLICY "Teachers can insert class_test_results for their class-subject combos"
  ON class_test_results FOR INSERT
  WITH CHECK (
    public.get_user_role() = 'teacher'
    AND EXISTS (
      SELECT 1
        FROM public.class_tests ct
        JOIN public.class_subjects cs
          ON cs.class_id   = ct.class_id
         AND cs.subject_id = ct.subject_id
       WHERE ct.id = class_test_results.class_test_id
         AND cs.teacher_id = public.get_my_teacher_id()
    )
  );

DROP POLICY IF EXISTS "Teachers can update class_test_results for their class-subject combos" ON class_test_results;
CREATE POLICY "Teachers can update class_test_results for their class-subject combos"
  ON class_test_results FOR UPDATE
  USING (
    public.get_user_role() = 'teacher'
    AND EXISTS (
      SELECT 1
        FROM public.class_tests ct
        JOIN public.class_subjects cs
          ON cs.class_id   = ct.class_id
         AND cs.subject_id = ct.subject_id
       WHERE ct.id = class_test_results.class_test_id
         AND cs.teacher_id = public.get_my_teacher_id()
    )
  );

COMMIT;


-- #####################################################################
-- ### erp/migration-122-class-sort-order-backfill.sql
-- #####################################################################
-- Migration 122 — recompute classes.sort_order for the A–Z section range.
--
-- ── Why ─────────────────────────────────────────────────────────────────────
-- The section picker offered only A, B and C, and sort_order was computed as
--
--     classIndex * 10 + sectionIndex
--
-- A multiplier of 10 only holds while there are fewer than ten sections. XI and
-- XII now want the letter to carry the stream — S for Science, C for Commerce,
-- H for Humanities — so the picker offers all 26, and with 26 the old formula
-- collides: Nursery-Z would score 25 and LKG-A 10, putting Nursery-Z after LKG.
-- The app now multiplies by 100.
--
-- Existing rows still hold the old ×10 values. Left alone they would interleave
-- wrongly with every newly saved class, on the 27 screens that order by this
-- column — every exam screen, the timetable, fees, reports, the roster.
--
-- Two other things this corrects:
--   * Classes created by the fees and results importers were all written with
--     sort_order = 0, so they sorted to the very top in a jumble.
--   * A section outside the known list scored -1, sorting a class BEFORE its
--     own A. Unknowns now sort last instead.
--
-- Nothing in the UI ever sets this column by hand — there is no reorder or drag
-- control anywhere — so recomputing it cannot destroy an arrangement somebody
-- made.
--
-- The two arrays below MUST match CLASS_ORDER and CLASS_SECTIONS in
-- packages/shared/src/lib/constants.ts. They are the same ordering, expressed
-- once for the app and once for this backfill.
--
-- Pure recomputation. SAFE TO RE-RUN.

BEGIN;

SET LOCAL search_path = public;

UPDATE public.classes SET sort_order =
  -- array_position is 1-based; -1 brings it back to the 0-based index the
  -- application uses. 98 is the bounded "unknown" slot, so an unrecognised
  -- name or section sorts last rather than first.
  COALESCE(
    array_position(
      ARRAY['Nursery','LKG','UKG','I','II','III','IV','V',
            'VI','VII','VIII','IX','X','XI','XII'],
      trim(name)
    ) - 1,
    98
  ) * 100
  + COALESCE(
    array_position(
      ARRAY['A','B','C','D','E','F','G','H','I','J','K','L','M',
            'N','O','P','Q','R','S','T','U','V','W','X','Y','Z'],
      upper(trim(section))
    ) - 1,
    98
  );

COMMIT;


-- #####################################################################
-- ### erp/migration-123-enrollment-exit-date.sql
-- #####################################################################
-- Migration 123 — stop billing a student the day they leave.
--
-- ── Why ─────────────────────────────────────────────────────────────────────
-- Dues are not stored, they are computed: `amountBilledToDate()` walks the
-- schedule and charges every instalment whose due date has passed. The
-- calculation reads the clock, never the roster, so a student who left after
-- the first quarter kept acquiring the second quarter's instalment, then the
-- third — money the school never intended to demand, sitting in the arrears
-- register and in every total computed from it.
--
-- Marking the enrollment 'exited' did not help, because nothing recorded WHEN
-- they left. `status_changed_at` is the moment the office typed it in, which
-- can be weeks after the child last attended.
--
-- This adds the missing fact: `exit_date`, the last day the student was on the
-- roll. The dues maths clamps its "as of" date to it, so an instalment falling
-- due after that date is never billed. The column is only consulted when the
-- enrollment is in an exit status ('exited' / 'terminated'), which is why
-- there is deliberately no CHECK constraint tying the two together — a stale
-- date left on a re-activated enrollment is inert, and a constraint here would
-- break the bulk importers that write `status` directly.
--
-- `student_status_history.effective_date` carries the same date onto the audit
-- row, so a later correction can be told apart from the original exit.
--
-- Idempotent throughout. SAFE TO RE-RUN.

BEGIN;

-- ─── 1. The column ──────────────────────────────────────────────────────────

ALTER TABLE student_enrollments
  ADD COLUMN IF NOT EXISTS exit_date date;

COMMENT ON COLUMN student_enrollments.exit_date IS
  'Last day the student was on the roll. Read ONLY when status is exited or '
  'terminated, and then it is the billing cutoff: an instalment due after this '
  'date is never charged. NULL on an exit means the dues maths falls back to '
  'status_changed_at. Set by change_enrollment_status(); see '
  'apps/erp/src/lib/fees.ts resolveBillingCutoff().';

-- Partial: the only rows ever queried by this column are the leavers.
CREATE INDEX IF NOT EXISTS idx_student_enrollments_exit_date
  ON student_enrollments (exit_date)
  WHERE exit_date IS NOT NULL;

ALTER TABLE student_status_history
  ADD COLUMN IF NOT EXISTS effective_date date;

COMMENT ON COLUMN student_status_history.effective_date IS
  'The exit_date recorded with this transition, when one was supplied. Lets a '
  'later correction to a leaving date be distinguished from the original exit.';

-- ─── 2. Backfill the students who already left ──────────────────────────────
-- Best available date, in order of authority:
--   1. the last-attended date on their Transfer Certificate — what the school
--      actually certified in writing, and only when it falls inside the year
--      the enrollment belongs to;
--   2. when the exit was recorded in the ERP;
--   3. the row's last write, for pre-087 rows that have neither.
--
-- Clamped to the academic year's end: an enrollment cannot be billed past the
-- session it belongs to, and a TC or a data-entry date from a later year would
-- otherwise re-open a closed year's billing.
--
-- The TC lookup is gated on the table existing: `transfer_certificates` is a
-- CMS table, and an ERP-only deployment has no such table. Without CMS the
-- backfill simply falls through to the recorded date.

DO $$
DECLARE
  v_has_tc boolean := to_regclass('public.transfer_certificates') IS NOT NULL;
BEGIN
  IF v_has_tc THEN
    UPDATE student_enrollments se
       SET exit_date = LEAST(
             COALESCE(
               (SELECT MAX(tc.last_attended_date)
                  FROM transfer_certificates tc
                 WHERE tc.student_id = se.student_id
                   AND tc.last_attended_date IS NOT NULL
                   AND tc.last_attended_date >= ay.start_date
                   AND tc.last_attended_date <= ay.end_date),
               se.status_changed_at::date,
               se.updated_at::date,
               ay.end_date
             ),
             ay.end_date
           )
      FROM academic_years ay
     WHERE ay.id = se.academic_year_id
       AND se.status IN ('exited', 'terminated')
       AND se.exit_date IS NULL;
  ELSE
    UPDATE student_enrollments se
       SET exit_date = LEAST(
             COALESCE(
               se.status_changed_at::date,
               se.updated_at::date,
               ay.end_date
             ),
             ay.end_date
           )
      FROM academic_years ay
     WHERE ay.id = se.academic_year_id
       AND se.status IN ('exited', 'terminated')
       AND se.exit_date IS NULL;
  END IF;
END $$;

-- ─── 3. change_enrollment_status() carries the date ─────────────────────────
-- Same signature as migration 087 — p_updates gains an optional "exit_date"
-- key per element, so existing callers that omit it keep working.
--
-- Entering an exit status without a date defaults to CURRENT_DATE rather than
-- leaving NULL: "today" is the honest reading of an exit typed in today, and a
-- NULL would silently restore the unbounded billing this migration exists to
-- stop. Leaving an exit status clears the date, so a re-admitted student
-- resumes billing.

CREATE OR REPLACE FUNCTION public.change_enrollment_status(
  p_updates jsonb,
  p_actor   uuid DEFAULT NULL,
  p_source  text DEFAULT 'manual'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_item        jsonb;
  v_enrollment  record;
  v_new_status  text;
  v_reason      text;
  v_exit_date   date;
  v_year_end    date;
  v_updated     int := 0;
  v_skipped     int := 0;
  v_inactive    uuid[] := ARRAY[]::uuid[];
  v_reactivated uuid[] := ARRAY[]::uuid[];
BEGIN
  IF jsonb_typeof(p_updates) <> 'array' THEN
    RAISE EXCEPTION 'p_updates must be a JSON array';
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_updates)
  LOOP
    v_new_status := v_item ->> 'status';
    v_reason     := NULLIF(btrim(COALESCE(v_item ->> 'reason', '')), '');

    SELECT se.id, se.student_id, se.class_id, se.academic_year_id, se.status
      INTO v_enrollment
      FROM student_enrollments se
      WHERE se.id = (v_item ->> 'enrollment_id')::uuid
      FOR UPDATE;

    IF NOT FOUND THEN
      v_skipped := v_skipped + 1;
      CONTINUE;
    END IF;

    -- A no-op still counts as skipped rather than writing a history row that
    -- records no transition.
    IF v_enrollment.status IS NOT DISTINCT FROM v_new_status THEN
      v_skipped := v_skipped + 1;
      CONTINUE;
    END IF;

    IF v_new_status IN ('terminated', 'exited') THEN
      v_exit_date := COALESCE(
        NULLIF(btrim(COALESCE(v_item ->> 'exit_date', '')), '')::date,
        CURRENT_DATE
      );
      -- Never past the session the enrollment belongs to: billing for a year
      -- stops when the year does, whatever date the office typed.
      SELECT ay.end_date INTO v_year_end
        FROM academic_years ay
        WHERE ay.id = v_enrollment.academic_year_id;
      IF v_year_end IS NOT NULL AND v_exit_date > v_year_end THEN
        v_exit_date := v_year_end;
      END IF;
    ELSE
      v_exit_date := NULL;
    END IF;

    INSERT INTO student_status_history (
      student_id, enrollment_id, academic_year_id, class_id,
      from_status, to_status, reason, source, changed_by, effective_date
    ) VALUES (
      v_enrollment.student_id, v_enrollment.id, v_enrollment.academic_year_id,
      v_enrollment.class_id, v_enrollment.status, v_new_status, v_reason,
      p_source, p_actor, v_exit_date
    );

    UPDATE student_enrollments
      SET status            = v_new_status,
          status_reason     = v_reason,
          status_changed_at = now(),
          status_changed_by = p_actor,
          exit_date         = v_exit_date,
          updated_at        = now()
      WHERE id = v_enrollment.id;

    IF v_new_status IN ('terminated', 'exited') THEN
      v_inactive := v_inactive || v_enrollment.student_id;
    ELSE
      v_reactivated := v_reactivated || v_enrollment.student_id;
    END IF;

    v_updated := v_updated + 1;
  END LOOP;

  -- students.is_active gates the admin listing, so it has to track the
  -- enrollment status. Set-based, after the loop, so a student appearing twice
  -- in one payload settles on their final state.
  IF array_length(v_inactive, 1) > 0 THEN
    UPDATE students
      SET is_active = false, updated_at = now()
      WHERE id = ANY(v_inactive) AND is_active IS DISTINCT FROM false;
  END IF;

  IF array_length(v_reactivated, 1) > 0 THEN
    UPDATE students
      SET is_active = true, updated_at = now()
      WHERE id = ANY(v_reactivated)
        AND id <> ALL(v_inactive)
        AND is_active IS DISTINCT FROM true;
  END IF;

  RETURN jsonb_build_object('updated', v_updated, 'skipped', v_skipped);
END;
$$;

REVOKE ALL ON FUNCTION public.change_enrollment_status(jsonb, uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.change_enrollment_status(jsonb, uuid, text) FROM anon, authenticated;

COMMIT;


-- #####################################################################
-- ### erp/migration-124-fee-payments-editor-rls.sql
-- #####################################################################
-- Migration 124 — let a staff member granted Fees actually read fee_payments.
--
-- ── The bug ─────────────────────────────────────────────────────────────────
-- A staff account holding the 'fees' editor grant opens Fees → Payment
-- Management, finds the student, and sees "No payments recorded yet" with
-- PAID ₹0 — while an admin looking at the same student sees ₹17,500 across two
-- receipts.
--
-- The grant is not the problem. It is doing its job: it passes the middleware
-- page gate, puts Fees in the sidebar, and satisfies verifyAdminOrEditor on
-- the write routes. The block is one layer lower. The fee screens read
-- fee_payments straight from the browser with the user's own JWT, so Postgres
-- applies RLS, and the only SELECT paths on that table are:
--
--     fee_payments_all_admin      role = 'admin'
--     fee_payments_select_student the student themselves
--     fee_payments_select_parent  their parents
--
-- role='staff' matches none of them. RLS filters rows rather than raising, so
-- the read returns zero rows with no error and the UI renders its empty state.
--
-- This is the same fault migration 084 fixed for students and
-- student_enrollments — its own header even lists fees among the affected
-- pages — but it only patched those two roster tables. The money table was
-- left behind.
--
-- Two consequences worse than the empty payment history:
--
--   * Dues & No-Dues prices every student with paid = 0, so the register shows
--     the WHOLE SCHOOL owing full fees and an empty No-Dues tab. Those are
--     numbers an operator acts on.
--   * Writes go through /api/fees/payments on the service-role client, which
--     bypasses RLS. So a staff member CAN record a payment and then cannot see
--     it — which invites recording it a second time.
--
-- ── The fix, and why it is feature-gated rather than role-coarse ────────────
-- 084 and 047 settled on role-coarse RLS ("RLS stays role-coarse so policy
-- bodies stay fast"), leaving per-feature gating to the application. That
-- reasoning was sound when a policy body was re-evaluated once per row — but
-- migration 102 established the fix for exactly that: wrapping the call as
-- (SELECT fn()) makes it an uncorrelated InitPlan, evaluated once per query
-- however many rows are scanned. With the wrapping below, a feature-aware
-- check costs the same as a role-coarse one, so the reason to stay coarse is
-- gone and there is no reason to hand every staff account in the school read
-- access to every family's payment history.
--
-- has_editor_capability() is deliberately general: it is the hook this
-- database has never had for editor_permissions, and the remaining tables with
-- this same gap (attendance, results, non_scholastic_assessments,
-- marksheet_publications — all still staff-blind) each become a six-line
-- follow-up once it exists.
--
-- ── Why this is additive ────────────────────────────────────────────────────
-- supabase-schema.sql is not a faithful mirror of the live policy set:
-- migration-erp-redesign renamed these policies and the rename was never
-- mirrored back (see migration 102's header). So this file DROPs and CREATEs
-- only its OWN new policy name and touches nothing that already exists.
-- Permissive policies are OR-ed, so adding one widens access by exactly the
-- predicate below and changes no existing rule.
--
-- SAFE TO RE-RUN.

BEGIN;

-- ─── 1. The capability helper ───────────────────────────────────────────────
-- True when the caller is an admin (who holds everything), or holds
-- p_feature in editor_permissions.
--
-- SECURITY DEFINER so the lookup is not itself subject to the RLS on profiles
-- and editor_permissions — the same pattern as get_user_role(). STABLE so the
-- planner may hoist it. It discloses nothing: it only ever answers a question
-- about the calling user, and only yes or no.

CREATE OR REPLACE FUNCTION public.has_editor_capability(p_feature text)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM public.profiles p
     WHERE p.id = auth.uid()
       AND (
         p.role = 'admin'
         OR EXISTS (
           SELECT 1
             FROM public.editor_permissions ep
            WHERE ep.editor_id = p.id
              AND ep.feature_key = p_feature
         )
       )
  );
$$;

COMMENT ON FUNCTION public.has_editor_capability(text) IS
  'True when the calling user holds this feature key: admins always, everyone '
  'else via editor_permissions. The RLS-side counterpart of '
  'verifyAdminOrEditor() in packages/shared/src/lib/verify-admin.ts. Call it '
  'wrapped as (SELECT has_editor_capability(''key'')) so it is evaluated once '
  'per query as an InitPlan rather than once per row — see migration 102.';

-- Explicit for logged-in users; it is the caller's own capability it reports.
--
-- PUBLIC's default EXECUTE is deliberately LEFT IN PLACE. Revoking it would
-- not harden anything — with no session the function returns false, which is
-- already the answer — but it WOULD turn an anonymous read of any table
-- carrying this policy from "zero rows" into a hard permission error, because
-- Postgres evaluates every permissive policy for whoever is querying. An empty
-- result is the correct and safer outcome there.
GRANT EXECUTE ON FUNCTION public.has_editor_capability(text) TO authenticated;

-- ─── 2. The policy ──────────────────────────────────────────────────────────
-- SELECT only. Every write already goes through a server route on the
-- service-role client (/api/fees/payments, /api/admin, the refund and
-- change-request routes), each of which runs verifyAdminOrEditor('fees')
-- first. Granting INSERT/UPDATE here would add a second, weaker way in that
-- bypasses the change-request workflow editors are deliberately held to.

DROP POLICY IF EXISTS "fee_payments_select_fee_editor" ON public.fee_payments;
CREATE POLICY "fee_payments_select_fee_editor"
  ON public.fee_payments FOR SELECT
  USING ((SELECT public.has_editor_capability('fees')));

COMMIT;

-- ── VERIFY ──────────────────────────────────────────────────────────────────
-- As the staff user, after granting them Fees on /people/users:
--
--   SELECT count(*), sum(amount_paid) FROM fee_payments WHERE student_id = '…';
--
-- should now match what an admin sees. And confirm the check is hoisted:
--
--   EXPLAIN (ANALYZE) SELECT id FROM fee_payments;
--   -- has_editor_capability should appear as InitPlan 1, not per row.


-- #####################################################################
-- ### erp/migration-125-editor-rls-remaining-tables.sql
-- #####################################################################
-- Migration 125 — finish the job 084 and 124 started: a granted feature works.
--
-- ── Why ─────────────────────────────────────────────────────────────────────
-- Admin-area screens read their data straight from the browser with the user's
-- own JWT, so Postgres applies RLS. Where a table has no policy admitting the
-- caller, RLS FILTERS ROWS RATHER THAN RAISING — the page renders, the read
-- returns nothing, and the screen shows its "nothing found" empty state. There
-- is no error anywhere to tell the operator, or the admin who granted the
-- feature, that anything is wrong. That is the whole failure mode: a feature
-- ticked on /people/users that silently does nothing.
--
-- Migration 084 fixed this for students and student_enrollments. Migration 124
-- fixed fee_payments and introduced has_editor_capability(). This one closes
-- the remainder, so the rule holds without exception: if a staff member is
-- granted a feature, the screens for that feature work.
--
-- ── The audit behind this list ──────────────────────────────────────────────
-- Every table read client-side from apps/erp/src/app/(admin)/** and from the
-- client components those pages mount was enumerated and its policy set
-- checked. Thirty tables already admit a staff caller and are deliberately
-- untouched here:
--
--   readable by anyone      academic_years, classes, class_subjects, subjects,
--                           streams, stream_subjects, exam_types, houses,
--                           timetable_periods, teachers, teacher_subjects,
--                           staff_members, fee_structures, calendar_events,
--                           grade_scales, grade_bands, class_grade_scales,
--                           exam_schedules, non_scholastic_subjects,
--                           non_scholastic_sub_subjects, bus_stops, buses,
--                           bus_route_stops, bus_stop_fees
--   explicit staff policy   students, student_enrollments (084), profiles
--   feature-gated           fee_payments (124)
--   self-read               editor_permissions
--
-- That leaves the five below — every one of them admin + teacher + student +
-- parent, with no path for a staff member however they were granted:
--
--   attendance                  /attendance                        'attendance'
--   results                     /exams/results                     'results'
--   non_scholastic_assessments  /exams/non-scholastic-assessments  'non_scholastic_entry'
--   marksheet_publications      /exams/publish                     'publish_results'
--   ptm_notes                   /exams/ptm-notes                   'ptm_notes'
--
-- Each key is the one the middleware gate already requires for that path, so a
-- policy grants exactly what ticking that box on /people/users promises — and
-- nothing else. A staff member granted Attendance still cannot read marks.
--
-- ── SELECT only, deliberately ───────────────────────────────────────────────
-- Not one of these five is written from the browser: marks entry, attendance
-- marking, publishing and PTM notes all post to server routes that run
-- verifyAdminOrEditor() on the service-role client. Adding INSERT/UPDATE here
-- would create a second, weaker way in that skips those checks. Read access is
-- the entire defect and the entire fix.
--
-- Unlike the student and parent policies on results and
-- non_scholastic_assessments, these carry NO is_published filter. An editor
-- entering and checking marks has to see them before they are published —
-- that is what the screen is for — which is why the admin policy has no such
-- filter either.
--
-- ── Additive by construction ────────────────────────────────────────────────
-- supabase-schema.sql is not a faithful mirror of the live policy set: the
-- redesign renamed these policies and the rename was never mirrored back (see
-- migration 102's header). Every statement below drops and creates only its
-- OWN new name, so it cannot disturb whatever a given deployment carries.
-- Permissive policies are OR-ed, so each adds exactly its predicate.
--
-- Every call is wrapped as (SELECT has_editor_capability(…)) so it is an
-- uncorrelated InitPlan — evaluated once per query rather than once per row
-- scanned. Migration 102 measured why that matters.
--
-- Requires migration 124 (has_editor_capability). SAFE TO RE-RUN.

BEGIN;

DO $mig$
BEGIN
  IF to_regprocedure('public.has_editor_capability(text)') IS NULL THEN
    RAISE EXCEPTION
      'has_editor_capability(text) is missing — apply migration 124 first.';
  END IF;
END
$mig$;

-- ─── attendance ─────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "attendance_select_editor" ON public.attendance;
CREATE POLICY "attendance_select_editor"
  ON public.attendance FOR SELECT
  USING ((SELECT public.has_editor_capability('attendance')));

-- ─── results ────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "results_select_editor" ON public.results;
CREATE POLICY "results_select_editor"
  ON public.results FOR SELECT
  USING ((SELECT public.has_editor_capability('results')));

-- ─── non_scholastic_assessments ─────────────────────────────────────────────
DROP POLICY IF EXISTS "non_scholastic_assessments_select_editor"
  ON public.non_scholastic_assessments;
CREATE POLICY "non_scholastic_assessments_select_editor"
  ON public.non_scholastic_assessments FOR SELECT
  USING ((SELECT public.has_editor_capability('non_scholastic_entry')));

-- ─── marksheet_publications ─────────────────────────────────────────────────
DROP POLICY IF EXISTS "marksheet_publications_select_editor"
  ON public.marksheet_publications;
CREATE POLICY "marksheet_publications_select_editor"
  ON public.marksheet_publications FOR SELECT
  USING ((SELECT public.has_editor_capability('publish_results')));

-- ─── ptm_notes ──────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "ptm_notes_select_editor" ON public.ptm_notes;
CREATE POLICY "ptm_notes_select_editor"
  ON public.ptm_notes FOR SELECT
  USING ((SELECT public.has_editor_capability('ptm_notes')));

COMMIT;

-- ── VERIFY ──────────────────────────────────────────────────────────────────
-- Grant a test staff account one feature at a time on /people/users and check
-- that its screen fills and no other does. Or, in SQL as that user:
--
--   SELECT count(*) FROM attendance;   -- non-zero only with 'attendance'
--   SELECT count(*) FROM results;      -- non-zero only with 'results'
--
-- And confirm the check is hoisted rather than run per row:
--
--   EXPLAIN (ANALYZE) SELECT id FROM results;
--   -- has_editor_capability should appear as an InitPlan, not in a per-row filter.


-- #####################################################################
-- ### erp/migration-126-set-enrollment-exit-date.sql
-- #####################################################################
-- Migration 126 — correct a leaving date after the fact.
--
-- ── Why ─────────────────────────────────────────────────────────────────────
-- Migration 123 made exit_date the billing cutoff: instalments falling due
-- after it are never charged. It is collected when a student is marked Exited
-- or Terminated, and backfilled for everyone who had already left — from their
-- TC's last-attended date where one falls inside the billed year, otherwise
-- from when the exit was typed into the ERP.
--
-- That fallback is the problem this fixes. When the paperwork lagged — the
-- child left in June, the office recorded it in September — the backfilled
-- date is the September one, and the student keeps two quarters of fees they
-- were never meant to owe. There was no way to correct it: the date field only
-- appears when moving INTO an exit status, and re-selecting the status a
-- student already holds is a no-op that change_enrollment_status() skips. The
-- only routes were hand-written SQL, or flipping them back to Active and
-- exiting them again, which fabricates two more transitions in their history.
--
-- ── Why an RPC and not an UPDATE from the route ─────────────────────────────
-- Same reason change_enrollment_status() is one (migration 087): the audit row
-- and the write must not come apart, and PostgREST gives the route no
-- transaction of its own. A correction that silently lost its history row is
-- exactly what this table exists to prevent — more so here, because moving
-- this date moves money.
--
-- The history row records from_status = to_status: the status did not change,
-- only the date attached to it. effective_date (added in 123 for precisely
-- this) carries the new value, so a correction reads differently from the
-- original exit rather than masquerading as one.
--
-- status_changed_at / status_changed_by are deliberately NOT touched. They
-- record when the student's status last changed, which a date correction does
-- not do. Nor is status_reason overwritten — the original "Family relocated to
-- Jaipur" must survive; the correction's own note lives on the history row.
--
-- SAFE TO RE-RUN.

BEGIN;

CREATE OR REPLACE FUNCTION public.set_enrollment_exit_date(
  p_enrollment_id uuid,
  p_exit_date     date,
  p_note          text DEFAULT NULL,
  p_actor         uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_enrollment record;
  v_year_end   date;
  v_new        date;
  v_note       text;
  v_reason     text;
BEGIN
  IF p_exit_date IS NULL THEN
    RAISE EXCEPTION 'A leaving date is required';
  END IF;

  SELECT se.id, se.student_id, se.class_id, se.academic_year_id,
         se.status, se.exit_date
    INTO v_enrollment
    FROM student_enrollments se
   WHERE se.id = p_enrollment_id
     FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Enrollment not found';
  END IF;

  -- A leaving date only means anything for someone who has left. On an active
  -- enrollment it would sit inert until some future status change, and the
  -- dues maths would ignore it — so refuse rather than store a value that
  -- looks set and does nothing.
  IF v_enrollment.status NOT IN ('exited', 'terminated') THEN
    RAISE EXCEPTION
      'Only a student marked Exited or Terminated has a leaving date (this one is %)',
      v_enrollment.status;
  END IF;

  -- A future date would bill instalments that have not been raised yet.
  IF p_exit_date > CURRENT_DATE THEN
    RAISE EXCEPTION 'A leaving date cannot be in the future';
  END IF;

  -- Billing for a session stops when the session does, whatever was typed.
  SELECT ay.end_date INTO v_year_end
    FROM academic_years ay
   WHERE ay.id = v_enrollment.academic_year_id;

  v_new := p_exit_date;
  IF v_year_end IS NOT NULL AND v_new > v_year_end THEN
    v_new := v_year_end;
  END IF;

  IF v_enrollment.exit_date IS NOT DISTINCT FROM v_new THEN
    RETURN jsonb_build_object(
      'changed', false,
      'exit_date', v_new
    );
  END IF;

  v_note := NULLIF(btrim(COALESCE(p_note, '')), '');

  -- Self-describing, so the history row stands on its own a year later — and
  -- long enough to satisfy the >= 5 character reason CHECK without forcing the
  -- office to type a justification for a typo fix. A note, when given, is
  -- appended rather than replacing it.
  v_reason := 'Leaving date corrected from '
           || COALESCE(v_enrollment.exit_date::text, '(not recorded)')
           || ' to ' || v_new::text
           || COALESCE(' — ' || v_note, '');

  INSERT INTO student_status_history (
    student_id, enrollment_id, academic_year_id, class_id,
    from_status, to_status, reason, source, changed_by, effective_date
  ) VALUES (
    v_enrollment.student_id, v_enrollment.id, v_enrollment.academic_year_id,
    v_enrollment.class_id,
    v_enrollment.status, v_enrollment.status,  -- a correction, not a transition
    v_reason, 'manual', p_actor, v_new
  );

  UPDATE student_enrollments
     SET exit_date  = v_new,
         updated_at = now()
   WHERE id = v_enrollment.id;

  RETURN jsonb_build_object(
    'changed', true,
    'exit_date', v_new,
    'previous_exit_date', v_enrollment.exit_date
  );
END;
$$;

COMMENT ON FUNCTION public.set_enrollment_exit_date(uuid, date, text, uuid) IS
  'Correct the leaving date on an enrollment that is already Exited or '
  'Terminated, writing the matching student_status_history row in the same '
  'transaction. The date is the fee billing cutoff (migration 123). Status, '
  'status_reason and status_changed_at are left untouched — this records a '
  'correction, not a transition.';

-- Authorised in the route via verifyAdminOrEditorWithUser("students"), exactly
-- as change_enrollment_status is. No grant to anon/authenticated.
REVOKE ALL ON FUNCTION public.set_enrollment_exit_date(uuid, date, text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.set_enrollment_exit_date(uuid, date, text, uuid) FROM anon, authenticated;

COMMIT;


-- #####################################################################
-- ### erp/migration-903-class-diary.sql
-- #####################################################################
-- Migration 903 (Murlipura-local) — Class Diary.
--
-- ── Why ─────────────────────────────────────────────────────────────────────
-- The school runs one WhatsApp group per class for daily homework, holiday
-- homework, fee reminders, function photos and the day's notices. This moves
-- that traffic into the ERP, where it is tied to the class roster the school
-- already maintains: a post reaches exactly the families whose child is
-- enrolled in the class, a parent who leaves the school stops seeing it, and
-- the phone numbers of 40 families are no longer visible to each other.
--
-- ── Numbering ───────────────────────────────────────────────────────────────
-- Murlipura-local migrations live in a reserved 9xx band (901 prospectus /
-- holiday-homework storage, 902 temp credentials, 903 this). Upstream NKPS
-- numbers globally and is at 126; the band keeps the two sequences from
-- colliding on every sync.
--
-- ── Shape ───────────────────────────────────────────────────────────────────
-- One row per (post, class). Posting the same homework to three sections
-- writes three rows sharing the same attachments, so each class's feed,
-- "seen by" count and delete are independent. class_id NULL means the whole
-- school (admin/editor only) — a fee-date reminder or a holiday notice.
--
-- Attachments are storage object paths in the PRIVATE "class-diary" bucket,
-- stored as a jsonb array of {path, name, type, size}. Nothing is public: the
-- API hands out short-lived signed URLs after it has checked the caller can
-- see the post, because photos of children do not belong in a public bucket.
--
-- ── Access ──────────────────────────────────────────────────────────────────
-- Every read and write goes through /api/class-diary with the service-role
-- client, which scopes rows in TypeScript (apps/erp/src/lib/class-diary.ts):
--   admin / editor with the class_diary feature → every class, school-wide
--   teacher → classes in get_my_class_ids() (class teacher OR subject teacher,
--             the same scope attendance and marks use)
--   parent  → classes their children are enrolled in this session
--   student → their own class this session
-- The SELECT policies below mirror that scope so a browser-client read can
-- never see more than the API would return. There are no write policies:
-- writes are API-only.
--
-- Idempotent. SAFE TO RE-RUN.

BEGIN;

SET LOCAL search_path = public;

CREATE TABLE IF NOT EXISTS class_diary_posts (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- NULL = whole school.
  class_id         uuid REFERENCES classes(id) ON DELETE CASCADE,
  academic_year_id uuid REFERENCES academic_years(id) ON DELETE SET NULL,
  subject_id       uuid REFERENCES subjects(id) ON DELETE SET NULL,
  kind             text NOT NULL,
  title            text NOT NULL,
  body             text NOT NULL DEFAULT '',
  -- The school day the post is for, in IST — not created_at, which is UTC and
  -- lands on the previous day for anything posted before 05:30.
  post_date        date NOT NULL DEFAULT (now() AT TIME ZONE 'Asia/Kolkata')::date,
  due_date         date,
  attachments      jsonb NOT NULL DEFAULT '[]'::jsonb,
  is_pinned        boolean NOT NULL DEFAULT false,
  -- Rows sharing a batch_id were posted together to several classes.
  batch_id         uuid,
  -- SET NULL, not CASCADE: a teacher's posts outlive their login.
  created_by       uuid REFERENCES profiles(id) ON DELETE SET NULL,
  -- Denormalised so the feed still names the author after the profile goes.
  author_name      text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT class_diary_kind_known CHECK (
    kind IN ('homework', 'holiday_homework', 'notice', 'fee_reminder', 'photos')
  ),
  CONSTRAINT class_diary_title_len CHECK (length(btrim(title)) BETWEEN 1 AND 200),
  CONSTRAINT class_diary_body_len CHECK (length(body) <= 5000),
  CONSTRAINT class_diary_attachments_array CHECK (jsonb_typeof(attachments) = 'array'),
  CONSTRAINT class_diary_due_after_post CHECK (due_date IS NULL OR due_date >= post_date)
);

CREATE INDEX IF NOT EXISTS idx_class_diary_class_date
  ON class_diary_posts (class_id, post_date DESC, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_class_diary_school_wide
  ON class_diary_posts (post_date DESC, created_at DESC) WHERE class_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_class_diary_created_by
  ON class_diary_posts (created_by);
CREATE INDEX IF NOT EXISTS idx_class_diary_subject
  ON class_diary_posts (subject_id);
CREATE INDEX IF NOT EXISTS idx_class_diary_year
  ON class_diary_posts (academic_year_id);
CREATE INDEX IF NOT EXISTS idx_class_diary_batch
  ON class_diary_posts (batch_id) WHERE batch_id IS NOT NULL;

DROP TRIGGER IF EXISTS set_updated_at_class_diary_posts ON class_diary_posts;
CREATE TRIGGER set_updated_at_class_diary_posts
  BEFORE UPDATE ON class_diary_posts
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Read receipts — the ERP's version of WhatsApp's blue ticks. One row per
-- (post, reader); the teacher sees a count, never a list of who has not read.
CREATE TABLE IF NOT EXISTS class_diary_reads (
  post_id    uuid NOT NULL REFERENCES class_diary_posts(id) ON DELETE CASCADE,
  profile_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  read_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (post_id, profile_id)
);

CREATE INDEX IF NOT EXISTS idx_class_diary_reads_profile
  ON class_diary_reads (profile_id);

-- ── RLS ─────────────────────────────────────────────────────────────────────
ALTER TABLE class_diary_posts ENABLE ROW LEVEL SECURITY;
ALTER TABLE class_diary_reads ENABLE ROW LEVEL SECURITY;

-- (select …) wrappers so each helper is evaluated once per statement rather
-- than once per row (migration 102).
DROP POLICY IF EXISTS "Admins and diary editors read class diary" ON class_diary_posts;
CREATE POLICY "Admins and diary editors read class diary"
  ON class_diary_posts FOR SELECT
  USING (
    (select public.get_user_role()) = 'admin'
    OR (select public.has_editor_feature('class_diary'))
  );

DROP POLICY IF EXISTS "Teachers read their classes' diary" ON class_diary_posts;
CREATE POLICY "Teachers read their classes' diary"
  ON class_diary_posts FOR SELECT
  USING (
    (select public.get_user_role()) = 'teacher'
    AND (
      class_id IS NULL
      OR class_id IN (SELECT public.get_my_class_ids())
      OR created_by = (select auth.uid())
    )
  );

DROP POLICY IF EXISTS "Students read their class diary" ON class_diary_posts;
CREATE POLICY "Students read their class diary"
  ON class_diary_posts FOR SELECT
  USING (
    (select public.get_user_role()) = 'student'
    AND (
      class_id IS NULL
      OR class_id IN (
        SELECT e.class_id
        FROM student_enrollments e
        JOIN academic_years y ON y.id = e.academic_year_id AND y.is_current
        WHERE e.student_id = (select public.get_my_student_id())
      )
    )
  );

DROP POLICY IF EXISTS "Parents read their children's class diary" ON class_diary_posts;
CREATE POLICY "Parents read their children's class diary"
  ON class_diary_posts FOR SELECT
  USING (
    (select public.get_user_role()) = 'parent'
    AND (
      class_id IS NULL
      OR class_id IN (
        SELECT e.class_id
        FROM student_enrollments e
        JOIN academic_years y ON y.id = e.academic_year_id AND y.is_current
        WHERE e.student_id IN (SELECT public.get_my_children_ids())
      )
    )
  );

DROP POLICY IF EXISTS "Users read their own diary receipts" ON class_diary_reads;
CREATE POLICY "Users read their own diary receipts"
  ON class_diary_reads FOR SELECT
  USING (profile_id = (select auth.uid()));

-- ── Storage ─────────────────────────────────────────────────────────────────
-- Private. No storage.objects policies on purpose: uploads use signed upload
-- URLs minted by /api/class-diary/upload-url after the scope check, and
-- downloads use signed URLs minted by the feed route.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'class-diary', 'class-diary', false, 10485760,
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'application/pdf']
)
ON CONFLICT (id) DO UPDATE
  SET public = EXCLUDED.public,
      file_size_limit = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;

COMMIT;
