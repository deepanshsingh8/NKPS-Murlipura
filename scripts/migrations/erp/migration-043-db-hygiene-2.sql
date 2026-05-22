-- Migration 043: DB hygiene round 2 — partial-unique on academic_years
-- and ~15 missing FK indexes audit-flagged in `tasks/erp-bug-audit-2.md`.
--
-- All idempotent. Re-running is safe.
--
-- NOT included here (intentionally):
--   • Renumbering of duplicate-prefix `027-*` and `031-*` migration files.
--     Those files have already been applied to live deployments; renaming
--     would create a "missing migration" if the deploy pipeline tracks by
--     filename. The schema mirror is the source of truth on fresh installs;
--     documented in the Round 2 audit doc.

-- ─────────────────────────────────────────────────────────────────────────
-- Partial-unique on academic_years.is_current (audit H13)
-- ─────────────────────────────────────────────────────────────────────────
-- Without this, two rows can have is_current=true and the app silently
-- misroutes year scoping. The plain index is then redundant — the partial
-- unique covers `WHERE is_current=true` lookups too.
--
-- Pre-flight: if the DB already has multiple is_current=true rows, this
-- ALTER fails. The DO block normalizes by keeping the most-recently-created
-- row as current and clearing the flag on the rest.

DO $$
DECLARE
  v_count int;
  v_keep uuid;
BEGIN
  SELECT COUNT(*) INTO v_count FROM academic_years WHERE is_current = true;
  IF v_count > 1 THEN
    SELECT id INTO v_keep
    FROM academic_years
    WHERE is_current = true
    ORDER BY created_at DESC NULLS LAST, id DESC
    LIMIT 1;
    UPDATE academic_years SET is_current = false
    WHERE is_current = true AND id <> v_keep;
    RAISE NOTICE 'Migration 043: collapsed % duplicate is_current rows; kept %', v_count, v_keep;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS academic_years_one_current
  ON academic_years(is_current)
  WHERE is_current = true;

-- ─────────────────────────────────────────────────────────────────────────
-- Missing FK indexes (audit H14)
-- ─────────────────────────────────────────────────────────────────────────
-- Each FK column without an index forces a sequential scan whenever the
-- parent row is updated/deleted (Postgres needs to confirm no children
-- still reference it) or whenever a join uses the column. Adding the
-- indexes is cheap and zero-risk.

CREATE INDEX IF NOT EXISTS idx_attendance_marked_by
  ON attendance(marked_by);

CREATE INDEX IF NOT EXISTS idx_fee_payments_recorded_by
  ON fee_payments(recorded_by);
CREATE INDEX IF NOT EXISTS idx_fee_payments_fee_structure_id
  ON fee_payments(fee_structure_id);
CREATE INDEX IF NOT EXISTS idx_fee_payments_refunded_by
  ON fee_payments(refunded_by);

CREATE INDEX IF NOT EXISTS idx_calendar_events_created_by
  ON calendar_events(created_by);
CREATE INDEX IF NOT EXISTS idx_calendar_events_class_id
  ON calendar_events(class_id);

CREATE INDEX IF NOT EXISTS idx_registration_requests_reviewed_by
  ON registration_requests(reviewed_by);

CREATE INDEX IF NOT EXISTS idx_marksheet_publications_published_by
  ON marksheet_publications(published_by);
CREATE INDEX IF NOT EXISTS idx_marksheet_publications_unpublished_by
  ON marksheet_publications(unpublished_by);

CREATE INDEX IF NOT EXISTS idx_publish_events_actor_id
  ON publish_events(actor_id);
CREATE INDEX IF NOT EXISTS idx_publish_events_class_id
  ON publish_events(class_id);

CREATE INDEX IF NOT EXISTS idx_payment_orders_fee_structure_id
  ON payment_orders(fee_structure_id);
CREATE INDEX IF NOT EXISTS idx_payment_orders_parent_id
  ON payment_orders(parent_id);

CREATE INDEX IF NOT EXISTS idx_editor_permissions_granted_by
  ON editor_permissions(granted_by);

CREATE INDEX IF NOT EXISTS idx_substitutions_assigned_by
  ON substitutions(assigned_by);

CREATE INDEX IF NOT EXISTS idx_exam_schedules_invigilator_teacher_id
  ON exam_schedules(invigilator_teacher_id);

CREATE INDEX IF NOT EXISTS idx_results_subject_id
  ON results(subject_id);

CREATE INDEX IF NOT EXISTS idx_ptm_notes_recorded_by
  ON ptm_notes(recorded_by);

CREATE INDEX IF NOT EXISTS idx_school_meeting_counts_exam_type_id
  ON school_meeting_counts(exam_type_id);
CREATE INDEX IF NOT EXISTS idx_school_meeting_counts_class_id
  ON school_meeting_counts(class_id);

CREATE INDEX IF NOT EXISTS idx_supplementary_attempts_subject_id
  ON supplementary_attempts(subject_id);
CREATE INDEX IF NOT EXISTS idx_supplementary_attempts_entered_by
  ON supplementary_attempts(entered_by);
