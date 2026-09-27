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
