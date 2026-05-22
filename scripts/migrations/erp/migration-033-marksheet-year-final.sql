-- Migration 033: support year-end "final result" snapshots in
-- marksheet_publications.
--
-- Background: the existing table is keyed on (student_id, exam_type_id) and
-- snapshots the per-exam ReportCardPDF data. Schools using result_master
-- with a year-end aggregate ("Final Result" with weighted exams + grace +
-- best-of) had no way to freeze that aggregate — the audit's C3 finding.
--
-- Decision (audit C3): reuse marksheet_publications by adding a `kind` column
-- with values 'per_exam' (legacy default) and 'year_final'. For year_final
-- rows, exam_type_id is NULL and academic_year_id is the de-facto key. This
-- keeps publish/unpublish/version history infra unchanged.
--
-- Idempotent: safe to re-run. No data migration needed — legacy rows default
-- to kind='per_exam' via the column default.

ALTER TABLE marksheet_publications
  ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'per_exam'
    CHECK (kind IN ('per_exam', 'year_final'));

ALTER TABLE marksheet_publications
  ADD COLUMN IF NOT EXISTS academic_year_id uuid
    REFERENCES academic_years(id) ON DELETE CASCADE;

-- exam_type_id was originally NOT NULL. Year-final rows have no exam_type, so
-- relax to nullable. The CHECK below enforces the kind ↔ column relationship.
ALTER TABLE marksheet_publications
  ALTER COLUMN exam_type_id DROP NOT NULL;

-- Enforce: per_exam rows have exam_type_id and no academic_year_id; year_final
-- rows have academic_year_id and no exam_type_id. Drop-and-recreate so this
-- migration is idempotent.
ALTER TABLE marksheet_publications
  DROP CONSTRAINT IF EXISTS marksheet_publications_kind_consistent;
ALTER TABLE marksheet_publications
  ADD CONSTRAINT marksheet_publications_kind_consistent
  CHECK (
    (kind = 'per_exam'
      AND exam_type_id IS NOT NULL
      AND academic_year_id IS NULL)
    OR (kind = 'year_final'
      AND exam_type_id IS NULL
      AND academic_year_id IS NOT NULL)
  );

-- The original UNIQUE(student_id, exam_type_id, version) doesn't cover
-- year_final rows. Replace with a kind-aware version uniqueness using
-- COALESCE so per_exam keeps using exam_type_id, year_final uses
-- academic_year_id.
ALTER TABLE marksheet_publications
  DROP CONSTRAINT IF EXISTS marksheet_publications_version_unique;

CREATE UNIQUE INDEX IF NOT EXISTS idx_marksheet_version_unique_per_exam
  ON marksheet_publications(student_id, exam_type_id, version)
  WHERE kind = 'per_exam';

CREATE UNIQUE INDEX IF NOT EXISTS idx_marksheet_version_unique_year_final
  ON marksheet_publications(student_id, academic_year_id, version)
  WHERE kind = 'year_final';

-- Same swap for the active-row partial unique. The legacy
-- idx_marksheet_active_one was on (student_id, exam_type_id); add a sibling
-- for year_final.
DROP INDEX IF EXISTS idx_marksheet_active_one;

CREATE UNIQUE INDEX IF NOT EXISTS idx_marksheet_active_one_per_exam
  ON marksheet_publications(student_id, exam_type_id)
  WHERE kind = 'per_exam' AND unpublished_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_marksheet_active_one_year_final
  ON marksheet_publications(student_id, academic_year_id)
  WHERE kind = 'year_final' AND unpublished_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_marksheet_year_final_year
  ON marksheet_publications(academic_year_id, class_id)
  WHERE kind = 'year_final';

-- Atomic per-student finalize for year_final, mirroring finalize_marksheet_one
-- (migration 032). Same shape: replace any active prior + insert a new
-- versioned row in a single transaction.
CREATE OR REPLACE FUNCTION public.finalize_year_final_one(
  p_student_id uuid,
  p_class_id uuid,
  p_academic_year_id uuid,
  p_snapshot jsonb,
  p_schema_version text,
  p_published_by uuid,
  p_unpublish_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  v_active_id uuid;
  v_latest_version int;
  v_new_id uuid;
  v_new_version int;
BEGIN
  SELECT COALESCE(MAX(version), 0) INTO v_latest_version
  FROM marksheet_publications
  WHERE student_id = p_student_id
    AND academic_year_id = p_academic_year_id
    AND kind = 'year_final';
  v_new_version := v_latest_version + 1;

  SELECT id INTO v_active_id
  FROM marksheet_publications
  WHERE student_id = p_student_id
    AND academic_year_id = p_academic_year_id
    AND kind = 'year_final'
    AND unpublished_at IS NULL
  LIMIT 1;

  IF v_active_id IS NOT NULL THEN
    UPDATE marksheet_publications
    SET unpublished_at = now(),
        unpublish_reason = p_unpublish_reason,
        unpublished_by = p_published_by
    WHERE id = v_active_id;
  END IF;

  INSERT INTO marksheet_publications (
    student_id,
    class_id,
    exam_type_id,
    academic_year_id,
    kind,
    version,
    snapshot,
    schema_version,
    published_by
  ) VALUES (
    p_student_id,
    p_class_id,
    NULL,
    p_academic_year_id,
    'year_final',
    v_new_version,
    p_snapshot,
    p_schema_version,
    p_published_by
  )
  RETURNING id INTO v_new_id;

  RETURN jsonb_build_object(
    'new_id', v_new_id,
    'version', v_new_version,
    'refinalized', v_active_id IS NOT NULL
  );
END;
$$;

-- publish_events.event_type allowlist needs to grow for the new flow.
ALTER TABLE publish_events
  DROP CONSTRAINT IF EXISTS publish_events_event_type_check;
ALTER TABLE publish_events
  ADD CONSTRAINT publish_events_event_type_check
  CHECK (event_type IN (
    'publish_results',
    'unpublish_results',
    'finalize_marksheet',
    'unpublish_marksheet',
    're_finalize_marksheet',
    'finalize_year_final',
    'unpublish_year_final',
    're_finalize_year_final'
  ));
