-- Migration 087 — student status history (why a student left, tracked over time).
--
-- Today `PATCH /api/students/status` writes `student_enrollments.status` and
-- flips `students.is_active`, and that is all: marking a student Exited or
-- Terminated records no reason and no actor, so a year later nobody can say
-- why a name disappeared from the roster.
--
-- ── Why an append-only table, not columns ───────────────────────────────────
-- Columns on student_enrollments would hold only the LATEST transition. A real
-- student path is active → exited → active → terminated, and each new hop
-- would destroy the previous reason — precisely the loss this feature exists
-- to prevent. The table is authoritative; three denormalised cache columns are
-- added alongside purely so the students list can show "why" without an N+1.
--
-- `publish_events` was considered and rejected: it has no from/to status or
-- enrollment reference (the transition would have to be stuffed into free-text
-- `note` and become unqueryable), its RLS is admin-read-only while status
-- changes are an editor-permitted action, and it is semantically the
-- results-publishing log.
--
-- ── Why an RPC ─────────────────────────────────────────────────────────────
-- PostgREST gives the app no client-side transaction. A status UPDATE followed
-- by a separate history INSERT can leave a status change with no reason on
-- record if the second call fails — the exact failure mode the feature guards
-- against. change_enrollment_status() does both in one transaction, and also
-- collapses the route's current 4+N round trips into one.

-- ─── 1. The history table ───────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS student_status_history (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id       uuid NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  -- SET NULL, not CASCADE: an audit row must outlive the enrollment it
  -- describes (same reasoning as migration 046's audit-log FK sweep).
  enrollment_id    uuid REFERENCES student_enrollments(id) ON DELETE SET NULL,
  academic_year_id uuid REFERENCES academic_years(id) ON DELETE SET NULL,
  class_id         uuid REFERENCES classes(id) ON DELETE SET NULL,
  from_status text CHECK (from_status IN ('active','passed','failed','terminated','exited')),
  to_status   text NOT NULL
    CHECK (to_status IN ('active','passed','failed','terminated','exited')),
  reason      text,
  source      text NOT NULL DEFAULT 'manual'
    CHECK (source IN ('manual','bulk','promotion','bulk_import','historical_import','system')),
  changed_by  uuid REFERENCES profiles(id) ON DELETE SET NULL,
  changed_at  timestamptz NOT NULL DEFAULT now(),
  -- The requirement, enforced at the lowest level so no future writer — route,
  -- script or console session — can record an exit without saying why.
  CONSTRAINT student_status_history_reason_required CHECK (
    to_status NOT IN ('terminated','exited')
    OR (reason IS NOT NULL AND length(btrim(reason)) >= 5)
  )
);

CREATE INDEX IF NOT EXISTS idx_ssh_student
  ON student_status_history(student_id, changed_at DESC);
CREATE INDEX IF NOT EXISTS idx_ssh_enrollment
  ON student_status_history(enrollment_id, changed_at DESC);

ALTER TABLE student_status_history ENABLE ROW LEVEL SECURITY;

-- Reads are admin-only. Writes go exclusively through the service-role client
-- (the RPC below), so no INSERT/UPDATE/DELETE policy is granted to anyone.
DROP POLICY IF EXISTS "Admins read student_status_history" ON student_status_history;
CREATE POLICY "Admins read student_status_history"
  ON student_status_history FOR SELECT
  USING (public.get_user_role() = 'admin');

-- ─── 2. Denormalised latest-value cache ─────────────────────────────────────
-- Lets the students table render the reason inline without joining history per
-- row. The table above stays the source of truth.

ALTER TABLE student_enrollments
  ADD COLUMN IF NOT EXISTS status_reason     text,
  ADD COLUMN IF NOT EXISTS status_changed_at timestamptz,
  ADD COLUMN IF NOT EXISTS status_changed_by uuid REFERENCES profiles(id) ON DELETE SET NULL;

-- ─── 3. Atomic status change ────────────────────────────────────────────────
-- p_updates: [{"enrollment_id": uuid, "status": text, "reason": text|null}, …]
--
-- Per element: reads the current row, skips no-ops, inserts a history row,
-- updates the status plus the cache columns, and finally flips
-- students.is_active for the affected students in two set-based statements.
--
-- The reason CHECK on student_status_history is what actually enforces the
-- "terminated/exited must have a reason" rule; the API validates too, for a
-- readable error, but the DB is the backstop.

CREATE OR REPLACE FUNCTION public.change_enrollment_status(
  p_updates jsonb,
  p_actor   uuid DEFAULT NULL,
  p_source  text DEFAULT 'manual'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_item        jsonb;
  v_enrollment  record;
  v_new_status  text;
  v_reason      text;
  v_updated     int := 0;
  v_skipped     int := 0;
  v_inactive    uuid[] := ARRAY[]::uuid[];
  v_reactivated uuid[] := ARRAY[]::uuid[];
BEGIN
  IF jsonb_typeof(p_updates) <> 'array' THEN
    RAISE EXCEPTION 'p_updates must be a JSON array';
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_updates)
  LOOP
    v_new_status := v_item ->> 'status';
    v_reason     := NULLIF(btrim(COALESCE(v_item ->> 'reason', '')), '');

    SELECT se.id, se.student_id, se.class_id, se.academic_year_id, se.status
      INTO v_enrollment
      FROM student_enrollments se
      WHERE se.id = (v_item ->> 'enrollment_id')::uuid
      FOR UPDATE;

    IF NOT FOUND THEN
      v_skipped := v_skipped + 1;
      CONTINUE;
    END IF;

    -- A no-op still counts as skipped rather than writing a history row that
    -- records no transition.
    IF v_enrollment.status IS NOT DISTINCT FROM v_new_status THEN
      v_skipped := v_skipped + 1;
      CONTINUE;
    END IF;

    INSERT INTO student_status_history (
      student_id, enrollment_id, academic_year_id, class_id,
      from_status, to_status, reason, source, changed_by
    ) VALUES (
      v_enrollment.student_id, v_enrollment.id, v_enrollment.academic_year_id,
      v_enrollment.class_id, v_enrollment.status, v_new_status, v_reason,
      p_source, p_actor
    );

    UPDATE student_enrollments
      SET status            = v_new_status,
          status_reason     = v_reason,
          status_changed_at = now(),
          status_changed_by = p_actor,
          updated_at        = now()
      WHERE id = v_enrollment.id;

    IF v_new_status IN ('terminated', 'exited') THEN
      v_inactive := v_inactive || v_enrollment.student_id;
    ELSE
      v_reactivated := v_reactivated || v_enrollment.student_id;
    END IF;

    v_updated := v_updated + 1;
  END LOOP;

  -- students.is_active gates the admin listing, so it has to track the
  -- enrollment status. Set-based, after the loop, so a student appearing twice
  -- in one payload settles on their final state.
  IF array_length(v_inactive, 1) > 0 THEN
    UPDATE students
      SET is_active = false, updated_at = now()
      WHERE id = ANY(v_inactive) AND is_active IS DISTINCT FROM false;
  END IF;

  IF array_length(v_reactivated, 1) > 0 THEN
    UPDATE students
      SET is_active = true, updated_at = now()
      WHERE id = ANY(v_reactivated)
        AND id <> ALL(v_inactive)
        AND is_active IS DISTINCT FROM true;
  END IF;

  RETURN jsonb_build_object('updated', v_updated, 'skipped', v_skipped);
END;
$$;

-- Callable only by the service-role client (the API route). No grant to
-- anon/authenticated: status changes are authorised in the route via
-- verifyAdminOrEditorWithUser("students").
REVOKE ALL ON FUNCTION public.change_enrollment_status(jsonb, uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.change_enrollment_status(jsonb, uuid, text) FROM anon, authenticated;

-- ─── 4. Backfill ────────────────────────────────────────────────────────────
-- Seed one history row per enrollment that is already in a non-active state,
-- so the timeline isn't blank for students who left before this shipped. The
-- reason is explicitly marked unknown rather than invented; `source='system'`
-- keeps these distinguishable from real recorded transitions, and the CHECK
-- above is satisfied because the placeholder is a genuine ≥5-char string.

INSERT INTO student_status_history (
  student_id, enrollment_id, academic_year_id, class_id,
  from_status, to_status, reason, source, changed_by, changed_at
)
SELECT se.student_id, se.id, se.academic_year_id, se.class_id,
       NULL, se.status,
       'Recorded before reason tracking existed — original reason unknown',
       'system', NULL, COALESCE(se.updated_at, now())
FROM student_enrollments se
WHERE se.status <> 'active'
  AND NOT EXISTS (
    SELECT 1 FROM student_status_history h WHERE h.enrollment_id = se.id
  );
