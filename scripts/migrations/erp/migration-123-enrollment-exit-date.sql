-- Migration 123 — stop billing a student the day they leave.
--
-- ── Why ─────────────────────────────────────────────────────────────────────
-- Dues are not stored, they are computed: `amountBilledToDate()` walks the
-- schedule and charges every instalment whose due date has passed. The
-- calculation reads the clock, never the roster, so a student who left after
-- the first quarter kept acquiring the second quarter's instalment, then the
-- third — money the school never intended to demand, sitting in the arrears
-- register and in every total computed from it.
--
-- Marking the enrollment 'exited' did not help, because nothing recorded WHEN
-- they left. `status_changed_at` is the moment the office typed it in, which
-- can be weeks after the child last attended.
--
-- This adds the missing fact: `exit_date`, the last day the student was on the
-- roll. The dues maths clamps its "as of" date to it, so an instalment falling
-- due after that date is never billed. The column is only consulted when the
-- enrollment is in an exit status ('exited' / 'terminated'), which is why
-- there is deliberately no CHECK constraint tying the two together — a stale
-- date left on a re-activated enrollment is inert, and a constraint here would
-- break the bulk importers that write `status` directly.
--
-- `student_status_history.effective_date` carries the same date onto the audit
-- row, so a later correction can be told apart from the original exit.
--
-- Idempotent throughout. SAFE TO RE-RUN.

BEGIN;

-- ─── 1. The column ──────────────────────────────────────────────────────────

ALTER TABLE student_enrollments
  ADD COLUMN IF NOT EXISTS exit_date date;

COMMENT ON COLUMN student_enrollments.exit_date IS
  'Last day the student was on the roll. Read ONLY when status is exited or '
  'terminated, and then it is the billing cutoff: an instalment due after this '
  'date is never charged. NULL on an exit means the dues maths falls back to '
  'status_changed_at. Set by change_enrollment_status(); see '
  'apps/erp/src/lib/fees.ts resolveBillingCutoff().';

-- Partial: the only rows ever queried by this column are the leavers.
CREATE INDEX IF NOT EXISTS idx_student_enrollments_exit_date
  ON student_enrollments (exit_date)
  WHERE exit_date IS NOT NULL;

ALTER TABLE student_status_history
  ADD COLUMN IF NOT EXISTS effective_date date;

COMMENT ON COLUMN student_status_history.effective_date IS
  'The exit_date recorded with this transition, when one was supplied. Lets a '
  'later correction to a leaving date be distinguished from the original exit.';

-- ─── 2. Backfill the students who already left ──────────────────────────────
-- Best available date, in order of authority:
--   1. the last-attended date on their Transfer Certificate — what the school
--      actually certified in writing, and only when it falls inside the year
--      the enrollment belongs to;
--   2. when the exit was recorded in the ERP;
--   3. the row's last write, for pre-087 rows that have neither.
--
-- Clamped to the academic year's end: an enrollment cannot be billed past the
-- session it belongs to, and a TC or a data-entry date from a later year would
-- otherwise re-open a closed year's billing.
--
-- The TC lookup is gated on the table existing: `transfer_certificates` is a
-- CMS table, and an ERP-only deployment has no such table. Without CMS the
-- backfill simply falls through to the recorded date.

DO $$
DECLARE
  v_has_tc boolean := to_regclass('public.transfer_certificates') IS NOT NULL;
BEGIN
  IF v_has_tc THEN
    UPDATE student_enrollments se
       SET exit_date = LEAST(
             COALESCE(
               (SELECT MAX(tc.last_attended_date)
                  FROM transfer_certificates tc
                 WHERE tc.student_id = se.student_id
                   AND tc.last_attended_date IS NOT NULL
                   AND tc.last_attended_date >= ay.start_date
                   AND tc.last_attended_date <= ay.end_date),
               se.status_changed_at::date,
               se.updated_at::date,
               ay.end_date
             ),
             ay.end_date
           )
      FROM academic_years ay
     WHERE ay.id = se.academic_year_id
       AND se.status IN ('exited', 'terminated')
       AND se.exit_date IS NULL;
  ELSE
    UPDATE student_enrollments se
       SET exit_date = LEAST(
             COALESCE(
               se.status_changed_at::date,
               se.updated_at::date,
               ay.end_date
             ),
             ay.end_date
           )
      FROM academic_years ay
     WHERE ay.id = se.academic_year_id
       AND se.status IN ('exited', 'terminated')
       AND se.exit_date IS NULL;
  END IF;
END $$;

-- ─── 3. change_enrollment_status() carries the date ─────────────────────────
-- Same signature as migration 087 — p_updates gains an optional "exit_date"
-- key per element, so existing callers that omit it keep working.
--
-- Entering an exit status without a date defaults to CURRENT_DATE rather than
-- leaving NULL: "today" is the honest reading of an exit typed in today, and a
-- NULL would silently restore the unbounded billing this migration exists to
-- stop. Leaving an exit status clears the date, so a re-admitted student
-- resumes billing.

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
  v_exit_date   date;
  v_year_end    date;
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

    IF v_new_status IN ('terminated', 'exited') THEN
      v_exit_date := COALESCE(
        NULLIF(btrim(COALESCE(v_item ->> 'exit_date', '')), '')::date,
        CURRENT_DATE
      );
      -- Never past the session the enrollment belongs to: billing for a year
      -- stops when the year does, whatever date the office typed.
      SELECT ay.end_date INTO v_year_end
        FROM academic_years ay
        WHERE ay.id = v_enrollment.academic_year_id;
      IF v_year_end IS NOT NULL AND v_exit_date > v_year_end THEN
        v_exit_date := v_year_end;
      END IF;
    ELSE
      v_exit_date := NULL;
    END IF;

    INSERT INTO student_status_history (
      student_id, enrollment_id, academic_year_id, class_id,
      from_status, to_status, reason, source, changed_by, effective_date
    ) VALUES (
      v_enrollment.student_id, v_enrollment.id, v_enrollment.academic_year_id,
      v_enrollment.class_id, v_enrollment.status, v_new_status, v_reason,
      p_source, p_actor, v_exit_date
    );

    UPDATE student_enrollments
      SET status            = v_new_status,
          status_reason     = v_reason,
          status_changed_at = now(),
          status_changed_by = p_actor,
          exit_date         = v_exit_date,
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

REVOKE ALL ON FUNCTION public.change_enrollment_status(jsonb, uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.change_enrollment_status(jsonb, uuid, text) FROM anon, authenticated;

COMMIT;
