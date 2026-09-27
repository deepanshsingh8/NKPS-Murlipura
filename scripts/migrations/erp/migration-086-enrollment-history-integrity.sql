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
