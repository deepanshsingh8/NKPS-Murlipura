-- Migration 027: Relax profiles FK constraints on audit-trail columns so
-- deleting a user (auth.users → profiles cascade) doesn't fail with foreign
-- key violations.
--
-- Symptom before: admin tries to delete an editor who has marked attendance /
-- entered marks / created a calendar event / etc. → Postgres aborts with
-- "update or delete on table \"profiles\" violates foreign key constraint"
-- because several audit-trail columns reference profiles(id) with no ON DELETE
-- action and (in some cases) NOT NULL.
--
-- Fix: every column that records "which user did this" is nullable and
-- ON DELETE SET NULL. Semantics: a NULL actor means "the user who did this
-- has since been deleted" — we preserve the record but lose the attribution,
-- which is the right trade-off for GDPR/admin hygiene.
--
-- Idempotent: safe to re-run. Uses conditional DROP CONSTRAINT / ALTER COLUMN
-- guarded against constraints/columns already in the desired state.

-- Helper: swap an existing FK to (ON DELETE SET NULL) and drop its NOT NULL.
CREATE OR REPLACE FUNCTION _relax_profile_fk(
  p_table text,
  p_column text
) RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_constraint_name text;
BEGIN
  -- Drop NOT NULL on the column if present.
  EXECUTE format('ALTER TABLE %I ALTER COLUMN %I DROP NOT NULL', p_table, p_column);

  -- Find the FK constraint name for (table, column → profiles.id).
  SELECT tc.constraint_name
    INTO v_constraint_name
  FROM information_schema.table_constraints tc
  JOIN information_schema.key_column_usage kcu
    ON tc.constraint_name = kcu.constraint_name
   AND tc.table_schema = kcu.table_schema
  JOIN information_schema.constraint_column_usage ccu
    ON tc.constraint_name = ccu.constraint_name
   AND tc.table_schema = ccu.table_schema
  WHERE tc.constraint_type = 'FOREIGN KEY'
    AND tc.table_name = p_table
    AND kcu.column_name = p_column
    AND ccu.table_name = 'profiles'
    AND ccu.column_name = 'id'
  LIMIT 1;

  IF v_constraint_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE %I DROP CONSTRAINT %I', p_table, v_constraint_name);
  END IF;

  EXECUTE format(
    'ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY (%I) REFERENCES profiles(id) ON DELETE SET NULL',
    p_table,
    p_table || '_' || p_column || '_fkey',
    p_column
  );
END;
$$;

-- Apply to all audit-trail profile references.
SELECT _relax_profile_fk('attendance', 'marked_by');
SELECT _relax_profile_fk('results', 'entered_by');
SELECT _relax_profile_fk('fee_payments', 'recorded_by');
SELECT _relax_profile_fk('calendar_events', 'created_by');
SELECT _relax_profile_fk('registration_requests', 'reviewed_by');
SELECT _relax_profile_fk('non_scholastic_assessments', 'entered_by');
SELECT _relax_profile_fk('class_tests', 'created_by');
SELECT _relax_profile_fk('class_test_results', 'entered_by');

DROP FUNCTION _relax_profile_fk(text, text);
