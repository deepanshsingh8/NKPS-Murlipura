-- Migration 035: Add an "admin_audit" event_type to publish_events so we can
-- piggyback non-marksheet admin actions on the existing audit log without
-- standing up a new table. New event types added here:
--   - revert_alumni — admin un-graduated a student
-- Future audit events can reuse the same `admin_audit` value with a
-- self-describing note.

ALTER TABLE publish_events DROP CONSTRAINT IF EXISTS publish_events_event_type_check;

ALTER TABLE publish_events ADD CONSTRAINT publish_events_event_type_check
  CHECK (
    event_type IN (
      'publish_results',
      'unpublish_results',
      'finalize_marksheet',
      'unpublish_marksheet',
      're_finalize_marksheet',
      'finalize_year_final',
      'unpublish_year_final',
      're_finalize_year_final',
      'revert_alumni',
      'admin_audit'
    )
  );
