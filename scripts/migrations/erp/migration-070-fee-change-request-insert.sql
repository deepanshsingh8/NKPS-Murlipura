-- =============================================================
-- Migration 070: fee_change_requests — support INSERT actions
-- =============================================================
-- Editors are blocked from clearing dues directly (waivers) the same way
-- they're blocked from direct refunds: they must file a change request for an
-- admin to approve. A waiver is a brand-new fee_payments row, so the change
-- request system — until now update/delete-only on an existing target row —
-- needs to model an INSERT (no target_id, no prior snapshot).
--
-- SAFE TO RE-RUN: drops/recreates named constraints; ALTER ... DROP NOT NULL
-- is idempotent.
-- =============================================================

BEGIN;

-- fee_change_requests: an INSERT request has no target row to point at or
-- snapshot, so both become nullable and a table-level CHECK keeps the two
-- shapes (insert vs update/delete) consistent.
ALTER TABLE fee_change_requests ALTER COLUMN target_id DROP NOT NULL;
ALTER TABLE fee_change_requests ALTER COLUMN current_snapshot DROP NOT NULL;

ALTER TABLE fee_change_requests
  DROP CONSTRAINT IF EXISTS fee_change_requests_action_check;
ALTER TABLE fee_change_requests
  ADD CONSTRAINT fee_change_requests_action_check
  CHECK (action IN ('insert', 'update', 'delete'));

ALTER TABLE fee_change_requests
  DROP CONSTRAINT IF EXISTS chk_change_request_target;
ALTER TABLE fee_change_requests
  ADD CONSTRAINT chk_change_request_target CHECK (
    (action = 'insert'
      AND target_id IS NULL
      AND current_snapshot IS NULL)
    OR (action IN ('update', 'delete')
      AND target_id IS NOT NULL
      AND current_snapshot IS NOT NULL)
  );

-- fee_change_audit_log: an applied INSERT has no before_snapshot and no
-- pre-existing target_id (the row is created during apply; its new id is
-- captured in after_snapshot).
ALTER TABLE fee_change_audit_log ALTER COLUMN target_id DROP NOT NULL;
ALTER TABLE fee_change_audit_log ALTER COLUMN before_snapshot DROP NOT NULL;

ALTER TABLE fee_change_audit_log
  DROP CONSTRAINT IF EXISTS fee_change_audit_log_action_check;
ALTER TABLE fee_change_audit_log
  ADD CONSTRAINT fee_change_audit_log_action_check
  CHECK (action IN ('insert', 'update', 'delete'));

COMMIT;
