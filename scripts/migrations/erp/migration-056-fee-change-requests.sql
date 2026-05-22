-- migration-056-fee-change-requests.sql
--
-- Adds the approval workflow that lets fees-editors propose changes to
-- already-recorded fee_payments without being able to apply the change
-- themselves. The wrong-amount scenario this protects against: an editor
-- records ₹25,000 instead of ₹2,500 and could otherwise quietly "fix" it.
-- With this in place, any mutation of an existing fee_payments row must
-- be raised as a request, reviewed by an admin, and applied through the
-- approve endpoint. Admins keep direct edit; their edits are written to
-- the audit log too.
--
-- Two tables:
--   fee_change_requests  — the queue editors file into and admins drain.
--   fee_change_audit_log — every applied change (approved request OR
--                          direct admin edit) is logged here. The
--                          source_request_id links the row back to the
--                          request that triggered it; nullable for
--                          direct admin edits.
--
-- target_table is constrained to fee_payments for now. Schema is shaped
-- so other tables (e.g. fee_structures) can be added by relaxing the
-- CHECK without a table rewrite.
--
-- RLS follows the same convention as fee_payments: enabled with an
-- admin-only policy, with all writes going through the service-role
-- API layer (verifyAdminOrEditorWithUser). Editors are gated at the API
-- gate, not the DB gate — same pattern as the rest of the fees module.
--
-- Idempotent.

CREATE TABLE IF NOT EXISTS fee_change_requests (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  target_table text NOT NULL
    CHECK (target_table IN ('fee_payments')),
  target_id uuid NOT NULL,
  action text NOT NULL
    CHECK (action IN ('update', 'delete')),
  -- Snapshot of the row at request time. Used by the admin reviewer to
  -- detect drift (someone else changed the row since the request was
  -- filed) and to recover the before-state for the audit log without
  -- another SELECT at approve-time.
  current_snapshot jsonb NOT NULL,
  -- Only the columns the editor wants to change. Empty object {} for
  -- delete actions. Apply step does an UPDATE ... SET <these keys>.
  proposed_changes jsonb NOT NULL DEFAULT '{}'::jsonb,
  reason text NOT NULL
    CHECK (char_length(reason) >= 5),
  requested_by uuid NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
  requested_at timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled')),
  reviewed_by uuid REFERENCES profiles(id) ON DELETE SET NULL,
  reviewed_at timestamptz,
  review_notes text,
  -- A reviewer must always exist on a terminal status, and never on a
  -- pending row. Keeps the audit story honest.
  CONSTRAINT chk_reviewer_terminal CHECK (
    (status = 'pending' AND reviewed_by IS NULL AND reviewed_at IS NULL)
    OR (status IN ('approved', 'rejected', 'cancelled')
        AND reviewed_at IS NOT NULL)
  )
);

-- One pending request per (table, row). A second editor hitting "request
-- change" on the same payment gets a clean "already pending" error from
-- this constraint instead of two diverging requests landing in the queue.
CREATE UNIQUE INDEX IF NOT EXISTS idx_fee_change_requests_one_pending
  ON fee_change_requests (target_table, target_id)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_fee_change_requests_status
  ON fee_change_requests (status, requested_at DESC);

CREATE INDEX IF NOT EXISTS idx_fee_change_requests_requester
  ON fee_change_requests (requested_by, requested_at DESC);

CREATE INDEX IF NOT EXISTS idx_fee_change_requests_target
  ON fee_change_requests (target_table, target_id);


CREATE TABLE IF NOT EXISTS fee_change_audit_log (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  target_table text NOT NULL,
  target_id uuid NOT NULL,
  action text NOT NULL
    CHECK (action IN ('update', 'delete')),
  before_snapshot jsonb NOT NULL,
  -- Null when action='delete' (the row no longer exists).
  after_snapshot jsonb,
  performed_by uuid NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
  performed_at timestamptz NOT NULL DEFAULT now(),
  -- Set when the change came from an approved request; null for direct
  -- admin edits. Either is auditable, but the link is the receipt.
  source_request_id uuid REFERENCES fee_change_requests(id) ON DELETE SET NULL,
  notes text
);

CREATE INDEX IF NOT EXISTS idx_fee_change_audit_target
  ON fee_change_audit_log (target_table, target_id, performed_at DESC);

CREATE INDEX IF NOT EXISTS idx_fee_change_audit_actor
  ON fee_change_audit_log (performed_by, performed_at DESC);


-- ── RLS ─────────────────────────────────────────────────────────────────────
-- Service-role API layer is the real gate. RLS here only matters for the
-- (unlikely) case where the anon/authed key reaches these tables.

ALTER TABLE fee_change_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins have full access to fee_change_requests"
  ON fee_change_requests;
CREATE POLICY "Admins have full access to fee_change_requests"
  ON fee_change_requests FOR ALL
  USING (public.get_user_role() = 'admin');

ALTER TABLE fee_change_audit_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins have full access to fee_change_audit_log"
  ON fee_change_audit_log;
CREATE POLICY "Admins have full access to fee_change_audit_log"
  ON fee_change_audit_log FOR ALL
  USING (public.get_user_role() = 'admin');
