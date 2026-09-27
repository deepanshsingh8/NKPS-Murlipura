-- Migration 126 — correct a leaving date after the fact.
--
-- ── Why ─────────────────────────────────────────────────────────────────────
-- Migration 123 made exit_date the billing cutoff: instalments falling due
-- after it are never charged. It is collected when a student is marked Exited
-- or Terminated, and backfilled for everyone who had already left — from their
-- TC's last-attended date where one falls inside the billed year, otherwise
-- from when the exit was typed into the ERP.
--
-- That fallback is the problem this fixes. When the paperwork lagged — the
-- child left in June, the office recorded it in September — the backfilled
-- date is the September one, and the student keeps two quarters of fees they
-- were never meant to owe. There was no way to correct it: the date field only
-- appears when moving INTO an exit status, and re-selecting the status a
-- student already holds is a no-op that change_enrollment_status() skips. The
-- only routes were hand-written SQL, or flipping them back to Active and
-- exiting them again, which fabricates two more transitions in their history.
--
-- ── Why an RPC and not an UPDATE from the route ─────────────────────────────
-- Same reason change_enrollment_status() is one (migration 087): the audit row
-- and the write must not come apart, and PostgREST gives the route no
-- transaction of its own. A correction that silently lost its history row is
-- exactly what this table exists to prevent — more so here, because moving
-- this date moves money.
--
-- The history row records from_status = to_status: the status did not change,
-- only the date attached to it. effective_date (added in 123 for precisely
-- this) carries the new value, so a correction reads differently from the
-- original exit rather than masquerading as one.
--
-- status_changed_at / status_changed_by are deliberately NOT touched. They
-- record when the student's status last changed, which a date correction does
-- not do. Nor is status_reason overwritten — the original "Family relocated to
-- Jaipur" must survive; the correction's own note lives on the history row.
--
-- SAFE TO RE-RUN.

BEGIN;

CREATE OR REPLACE FUNCTION public.set_enrollment_exit_date(
  p_enrollment_id uuid,
  p_exit_date     date,
  p_note          text DEFAULT NULL,
  p_actor         uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_enrollment record;
  v_year_end   date;
  v_new        date;
  v_note       text;
  v_reason     text;
BEGIN
  IF p_exit_date IS NULL THEN
    RAISE EXCEPTION 'A leaving date is required';
  END IF;

  SELECT se.id, se.student_id, se.class_id, se.academic_year_id,
         se.status, se.exit_date
    INTO v_enrollment
    FROM student_enrollments se
   WHERE se.id = p_enrollment_id
     FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Enrollment not found';
  END IF;

  -- A leaving date only means anything for someone who has left. On an active
  -- enrollment it would sit inert until some future status change, and the
  -- dues maths would ignore it — so refuse rather than store a value that
  -- looks set and does nothing.
  IF v_enrollment.status NOT IN ('exited', 'terminated') THEN
    RAISE EXCEPTION
      'Only a student marked Exited or Terminated has a leaving date (this one is %)',
      v_enrollment.status;
  END IF;

  -- A future date would bill instalments that have not been raised yet.
  IF p_exit_date > CURRENT_DATE THEN
    RAISE EXCEPTION 'A leaving date cannot be in the future';
  END IF;

  -- Billing for a session stops when the session does, whatever was typed.
  SELECT ay.end_date INTO v_year_end
    FROM academic_years ay
   WHERE ay.id = v_enrollment.academic_year_id;

  v_new := p_exit_date;
  IF v_year_end IS NOT NULL AND v_new > v_year_end THEN
    v_new := v_year_end;
  END IF;

  IF v_enrollment.exit_date IS NOT DISTINCT FROM v_new THEN
    RETURN jsonb_build_object(
      'changed', false,
      'exit_date', v_new
    );
  END IF;

  v_note := NULLIF(btrim(COALESCE(p_note, '')), '');

  -- Self-describing, so the history row stands on its own a year later — and
  -- long enough to satisfy the >= 5 character reason CHECK without forcing the
  -- office to type a justification for a typo fix. A note, when given, is
  -- appended rather than replacing it.
  v_reason := 'Leaving date corrected from '
           || COALESCE(v_enrollment.exit_date::text, '(not recorded)')
           || ' to ' || v_new::text
           || COALESCE(' — ' || v_note, '');

  INSERT INTO student_status_history (
    student_id, enrollment_id, academic_year_id, class_id,
    from_status, to_status, reason, source, changed_by, effective_date
  ) VALUES (
    v_enrollment.student_id, v_enrollment.id, v_enrollment.academic_year_id,
    v_enrollment.class_id,
    v_enrollment.status, v_enrollment.status,  -- a correction, not a transition
    v_reason, 'manual', p_actor, v_new
  );

  UPDATE student_enrollments
     SET exit_date  = v_new,
         updated_at = now()
   WHERE id = v_enrollment.id;

  RETURN jsonb_build_object(
    'changed', true,
    'exit_date', v_new,
    'previous_exit_date', v_enrollment.exit_date
  );
END;
$$;

COMMENT ON FUNCTION public.set_enrollment_exit_date(uuid, date, text, uuid) IS
  'Correct the leaving date on an enrollment that is already Exited or '
  'Terminated, writing the matching student_status_history row in the same '
  'transaction. The date is the fee billing cutoff (migration 123). Status, '
  'status_reason and status_changed_at are left untouched — this records a '
  'correction, not a transition.';

-- Authorised in the route via verifyAdminOrEditorWithUser("students"), exactly
-- as change_enrollment_status is. No grant to anon/authenticated.
REVOKE ALL ON FUNCTION public.set_enrollment_exit_date(uuid, date, text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.set_enrollment_exit_date(uuid, date, text, uuid) FROM anon, authenticated;

COMMIT;
