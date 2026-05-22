-- Migration 032: atomic finalize_marksheet_one() RPC.
--
-- The route used to do (per student): unpublish-prior + insert-new as two
-- separate statements. If the INSERT failed mid-loop the row was left in
-- limbo: prior was unpublished, new version never existed, and the audit
-- row from publish_events claimed N students were finalized.
--
-- This function wraps the unpublish + insert in a single statement-level
-- transaction so either both happen or neither does. Idempotent: callers
-- still iterate per student, but each iteration is atomic.

CREATE OR REPLACE FUNCTION public.finalize_marksheet_one(
  p_student_id uuid,
  p_class_id uuid,
  p_exam_type_id uuid,
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
  -- Latest version (active or not) across all rows for this (student, exam).
  SELECT COALESCE(MAX(version), 0) INTO v_latest_version
  FROM marksheet_publications
  WHERE student_id = p_student_id AND exam_type_id = p_exam_type_id;

  v_new_version := v_latest_version + 1;

  -- Active prior, if any. The partial UNIQUE on
  -- (student_id, exam_type_id) WHERE unpublished_at IS NULL guarantees this
  -- returns at most one row.
  SELECT id INTO v_active_id
  FROM marksheet_publications
  WHERE student_id = p_student_id
    AND exam_type_id = p_exam_type_id
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
    version,
    snapshot,
    schema_version,
    published_by
  )
  VALUES (
    p_student_id,
    p_class_id,
    p_exam_type_id,
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
