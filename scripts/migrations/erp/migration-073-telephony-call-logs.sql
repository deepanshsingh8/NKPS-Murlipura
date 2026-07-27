-- migration-073-telephony-call-logs.sql
--
-- Click-to-call: teachers/admins ring a student's parent/guardian from the ERP
-- through Exotel, which bridges the two legs so neither party sees the other's
-- real number (both see the school's ExoPhone). This table is the audit trail
-- for every such call.
--
-- PII stance: we deliberately DO NOT store the numbers dialled — only
-- `contact_type` (which relation was called) plus the student/actor FKs. The
-- resolvable numbers already live on `students` / `profiles`; duplicating them
-- here would spread PII with no benefit. Exotel's own call SID + status close
-- the loop for support/billing questions.
--
-- The agent leg (the staff member's own phone Exotel rings first) is read from
-- profiles.phone at call time — no new column needed.
--
-- RLS follows the fees-module convention: enabled with an admin-only policy;
-- the real gate is the service-role API layer (verifyAdminOrEditorWithUser),
-- where editors granted the `students` feature are allowed. Idempotent.

CREATE TABLE IF NOT EXISTS call_logs (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  -- Who placed the call. RESTRICT: an audit row must never be orphaned by a
  -- profile delete; reassign/close out staff before removing them.
  actor_id uuid NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
  -- SET NULL so call history survives a student record being deleted.
  student_id uuid REFERENCES students(id) ON DELETE SET NULL,
  -- Which number on the student was dialled. No raw number is stored.
  contact_type text NOT NULL
    CHECK (contact_type IN ('student', 'father', 'mother', 'guardian')),
  -- Exotel's Call Sid, populated once the connect API responds. Null while a
  -- call is still 'initiated' or if dispatch failed before Exotel accepted it.
  exotel_sid text,
  -- Lifecycle: 'initiated' (row written, pre-dispatch) → Exotel's own statuses
  -- via the connect response and the status-callback webhook. 'error' is our
  -- terminal state when the dispatch itself threw.
  status text NOT NULL DEFAULT 'initiated'
    CHECK (status IN (
      'initiated', 'error', 'queued', 'in-progress',
      'completed', 'failed', 'busy', 'no-answer', 'canceled'
    )),
  duration_seconds integer,
  recording_url text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Serves both per-actor rate limiting (count recent rows) and an actor's own
-- call history.
CREATE INDEX IF NOT EXISTS idx_call_logs_actor
  ON call_logs (actor_id, created_at DESC);

-- Per-student call history in the detail view.
CREATE INDEX IF NOT EXISTS idx_call_logs_student
  ON call_logs (student_id, created_at DESC);

-- The status-callback webhook looks a row up by Exotel's Sid.
CREATE INDEX IF NOT EXISTS idx_call_logs_exotel_sid
  ON call_logs (exotel_sid)
  WHERE exotel_sid IS NOT NULL;


-- ── RLS ─────────────────────────────────────────────────────────────────────
-- Service-role API layer is the real gate. RLS here only matters for the
-- (unlikely) case where the anon/authed key reaches this table.

ALTER TABLE call_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins have full access to call_logs" ON call_logs;
CREATE POLICY "Admins have full access to call_logs"
  ON call_logs FOR ALL
  USING (public.get_user_role() = 'admin');
