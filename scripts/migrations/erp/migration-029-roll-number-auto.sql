-- Migration 025: Roll Number dynamic reordering.
--
-- Replaces the historical NULL-by-default `student_enrollments.roll_number`
-- with an auto-assigned system:
--   * Column `roll_number_manual` lets admins pin a row so auto-recompute
--     never touches it (conservative default for any row already set).
--   * Function `recompute_roll_numbers(class_id, sort_key)` assigns
--     sequential 1..N within the class (section is already baked into
--     `class_id` via UNIQUE(name, section, academic_year_id, stream_id)).
--   * Partial unique index enforces per-class uniqueness for active rows.
--   * Triggers on enrollment INSERT / DELETE, status UPDATE, and student
--     `full_name` UPDATE keep the numbering tight without manual intervention.
--
-- Sort key handling:
--   * `'name'`            → `students.full_name ASC` (alphabetical, default).
--   * `'admission_no'`    → `students.admission_no ASC`.
--   * `'previous_rank'`   → computed by the caller (see
--     `src/lib/final-result.ts::computeRanksForClass`) because rank depends
--     on Phase 4 result-master configuration that is awkward to re-derive in
--     plain SQL. The API route passes an ordered student id list to the
--     companion function `apply_roll_numbers(class_id, ordered_student_ids)`.
--
-- Idempotent: safe to re-run. Triggers and functions use CREATE OR REPLACE.
-- The backfill DO block at the bottom only touches classes that have active
-- enrollments, and the conservative "mark manual on drift" step runs before
-- the mass recompute so existing manual work is preserved.

-- ─── Diagnostic reference (read-only; commented for reference) ──────────────
-- Current roll_number distribution per class (uncomment to inspect):
-- SELECT c.name, c.section, count(*) AS active,
--        count(*) FILTER (WHERE se.roll_number IS NULL) AS null_roll
-- FROM student_enrollments se
-- JOIN classes c ON c.id = se.class_id
-- WHERE se.status = 'active'
-- GROUP BY c.id, c.name, c.section
-- ORDER BY c.sort_order;

-- ─── 1. Column + index ───────────────────────────────────────────────────────

ALTER TABLE student_enrollments
  ADD COLUMN IF NOT EXISTS roll_number_manual boolean NOT NULL DEFAULT false;

-- Partial unique: (class_id, roll_number) must be unique among active rows.
CREATE UNIQUE INDEX IF NOT EXISTS student_enrollments_class_rollno_active_unique
  ON student_enrollments (class_id, roll_number)
  WHERE status = 'active' AND roll_number IS NOT NULL;

-- ─── 2. Core recompute function ─────────────────────────────────────────────
-- Orders active enrollments for p_class_id by p_sort_key, then assigns
-- sequential numbers 1..N skipping rows with roll_number_manual=true (those
-- keep their current number; the running counter still increments over them
-- to prevent collisions with manual pins).
-- Two-phase update (null out first, then re-number) avoids transient unique
-- violations on the partial index when rows swap numbers.
-- Design choice: `previous_rank` sort is NOT implemented in this function —
-- see apply_roll_numbers() below. Keeps this function dependency-free on the
-- Phase 4 result engine.

CREATE OR REPLACE FUNCTION recompute_roll_numbers(
  p_class_id uuid,
  p_sort_key text DEFAULT 'name'
)
RETURNS integer
LANGUAGE plpgsql
AS $$
DECLARE
  v_counter integer := 0;
  v_row RECORD;
  v_taken_manual int[] := ARRAY[]::int[];
  v_updated int := 0;
BEGIN
  IF p_sort_key NOT IN ('name', 'admission_no') THEN
    RAISE EXCEPTION 'recompute_roll_numbers: unsupported sort_key %, allowed: name, admission_no (previous_rank uses apply_roll_numbers)', p_sort_key;
  END IF;

  -- Collect manual pins so the sequential counter can skip those numbers.
  SELECT COALESCE(array_agg(roll_number ORDER BY roll_number), ARRAY[]::int[])
    INTO v_taken_manual
  FROM student_enrollments
  WHERE class_id = p_class_id
    AND status = 'active'
    AND roll_number_manual = true
    AND roll_number IS NOT NULL;

  -- Phase 1: null out all non-manual roll numbers so we can reassign cleanly.
  UPDATE student_enrollments
     SET roll_number = NULL
   WHERE class_id = p_class_id
     AND status = 'active'
     AND roll_number_manual = false;

  -- Phase 2: walk the ordered list and assign the next free number.
  FOR v_row IN
    SELECT se.id, s.full_name, s.admission_no
    FROM student_enrollments se
    JOIN students s ON s.id = se.student_id
    WHERE se.class_id = p_class_id
      AND se.status = 'active'
      AND se.roll_number_manual = false
    ORDER BY
      CASE WHEN p_sort_key = 'name'         THEN s.full_name    END ASC NULLS LAST,
      CASE WHEN p_sort_key = 'admission_no' THEN s.admission_no END ASC NULLS LAST,
      s.full_name ASC,
      se.id ASC
  LOOP
    v_counter := v_counter + 1;
    -- Skip any number a manual row already holds.
    WHILE v_counter = ANY(v_taken_manual) LOOP
      v_counter := v_counter + 1;
    END LOOP;

    UPDATE student_enrollments
       SET roll_number = v_counter
     WHERE id = v_row.id;
    v_updated := v_updated + 1;
  END LOOP;

  RETURN v_updated;
END;
$$;

-- Companion function for `previous_rank` — accepts a caller-computed ordered
-- list of student_ids and applies 1..N to those rows' enrollments in that
-- class. Shares the manual-pin skip logic with recompute_roll_numbers.

CREATE OR REPLACE FUNCTION apply_roll_numbers(
  p_class_id uuid,
  p_ordered_student_ids uuid[]
)
RETURNS integer
LANGUAGE plpgsql
AS $$
DECLARE
  v_counter integer := 0;
  v_student_id uuid;
  v_enrollment_id uuid;
  v_taken_manual int[] := ARRAY[]::int[];
  v_updated int := 0;
BEGIN
  SELECT COALESCE(array_agg(roll_number ORDER BY roll_number), ARRAY[]::int[])
    INTO v_taken_manual
  FROM student_enrollments
  WHERE class_id = p_class_id
    AND status = 'active'
    AND roll_number_manual = true
    AND roll_number IS NOT NULL;

  UPDATE student_enrollments
     SET roll_number = NULL
   WHERE class_id = p_class_id
     AND status = 'active'
     AND roll_number_manual = false;

  -- Apply in caller-supplied order first.
  FOREACH v_student_id IN ARRAY p_ordered_student_ids
  LOOP
    SELECT id INTO v_enrollment_id
    FROM student_enrollments
    WHERE class_id = p_class_id
      AND student_id = v_student_id
      AND status = 'active'
      AND roll_number_manual = false
    LIMIT 1;

    IF v_enrollment_id IS NULL THEN
      CONTINUE;
    END IF;

    v_counter := v_counter + 1;
    WHILE v_counter = ANY(v_taken_manual) LOOP
      v_counter := v_counter + 1;
    END LOOP;

    UPDATE student_enrollments
       SET roll_number = v_counter
     WHERE id = v_enrollment_id;
    v_updated := v_updated + 1;
  END LOOP;

  -- Any unranked active students (not in p_ordered_student_ids) get numbered
  -- next, alphabetically by full_name — keeps ordering deterministic.
  FOR v_enrollment_id IN
    SELECT se.id
    FROM student_enrollments se
    JOIN students s ON s.id = se.student_id
    WHERE se.class_id = p_class_id
      AND se.status = 'active'
      AND se.roll_number_manual = false
      AND se.roll_number IS NULL
    ORDER BY s.full_name ASC, se.id ASC
  LOOP
    v_counter := v_counter + 1;
    WHILE v_counter = ANY(v_taken_manual) LOOP
      v_counter := v_counter + 1;
    END LOOP;

    UPDATE student_enrollments
       SET roll_number = v_counter
     WHERE id = v_enrollment_id;
    v_updated := v_updated + 1;
  END LOOP;

  RETURN v_updated;
END;
$$;

-- ─── 3. Trigger functions ───────────────────────────────────────────────────

-- INSERT: new enrollment → recompute that class alphabetically.
CREATE OR REPLACE FUNCTION trg_enrollment_insert_recompute()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.status = 'active' THEN
    PERFORM recompute_roll_numbers(NEW.class_id, 'name');
  END IF;
  RETURN NEW;
END;
$$;

-- DELETE: removed enrollment → recompute that class.
CREATE OR REPLACE FUNCTION trg_enrollment_delete_recompute()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.status = 'active' THEN
    PERFORM recompute_roll_numbers(OLD.class_id, 'name');
  END IF;
  RETURN OLD;
END;
$$;

-- UPDATE of status or class_id: recompute both the old and new class if
-- anything affecting roll-number membership changed.
CREATE OR REPLACE FUNCTION trg_enrollment_update_recompute()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.status IS DISTINCT FROM NEW.status OR OLD.class_id IS DISTINCT FROM NEW.class_id THEN
    IF OLD.class_id IS NOT NULL THEN
      PERFORM recompute_roll_numbers(OLD.class_id, 'name');
    END IF;
    IF NEW.class_id IS NOT NULL AND NEW.class_id IS DISTINCT FROM OLD.class_id THEN
      PERFORM recompute_roll_numbers(NEW.class_id, 'name');
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

-- UPDATE of students.full_name: recompute every active class the student is
-- currently enrolled in.
CREATE OR REPLACE FUNCTION trg_student_name_recompute()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_class_id uuid;
BEGIN
  IF OLD.full_name IS DISTINCT FROM NEW.full_name THEN
    FOR v_class_id IN
      SELECT DISTINCT class_id FROM student_enrollments
      WHERE student_id = NEW.id AND status = 'active'
    LOOP
      PERFORM recompute_roll_numbers(v_class_id, 'name');
    END LOOP;
  END IF;
  RETURN NEW;
END;
$$;

-- ─── 4. Triggers ────────────────────────────────────────────────────────────

DROP TRIGGER IF EXISTS enrollment_after_insert_recompute ON student_enrollments;
CREATE TRIGGER enrollment_after_insert_recompute
  AFTER INSERT ON student_enrollments
  FOR EACH ROW EXECUTE FUNCTION trg_enrollment_insert_recompute();

DROP TRIGGER IF EXISTS enrollment_after_delete_recompute ON student_enrollments;
CREATE TRIGGER enrollment_after_delete_recompute
  AFTER DELETE ON student_enrollments
  FOR EACH ROW EXECUTE FUNCTION trg_enrollment_delete_recompute();

DROP TRIGGER IF EXISTS enrollment_after_update_recompute ON student_enrollments;
CREATE TRIGGER enrollment_after_update_recompute
  AFTER UPDATE OF status, class_id ON student_enrollments
  FOR EACH ROW
  WHEN (OLD.status IS DISTINCT FROM NEW.status OR OLD.class_id IS DISTINCT FROM NEW.class_id)
  EXECUTE FUNCTION trg_enrollment_update_recompute();

DROP TRIGGER IF EXISTS student_after_name_update_recompute ON students;
CREATE TRIGGER student_after_name_update_recompute
  AFTER UPDATE OF full_name ON students
  FOR EACH ROW
  WHEN (OLD.full_name IS DISTINCT FROM NEW.full_name)
  EXECUTE FUNCTION trg_student_name_recompute();

-- ─── 5. Backfill (idempotent) ───────────────────────────────────────────────
-- Step A: For each class with active enrollments whose current roll-number
-- ordering diverges from alphabetical, mark every row in that class as manual.
-- Conservative: preserves pre-existing manual work (the old NULL-default
-- system allowed admins to hand-enter roll numbers; those numbers should
-- survive the automated migration).
-- Step B: Run recompute_roll_numbers() for every class with active
-- enrollments. Rows now flagged manual keep their numbers; NULL rows get
-- sequential numbers in whatever gaps remain.

DO $$
DECLARE
  v_class RECORD;
  v_alphabetical_order uuid[];
  v_current_order uuid[];
BEGIN
  FOR v_class IN
    SELECT DISTINCT c.id AS class_id
    FROM classes c
    JOIN student_enrollments se ON se.class_id = c.id
    WHERE se.status = 'active'
  LOOP
    -- Alphabetical order of student_ids, nulls last.
    SELECT COALESCE(array_agg(se.student_id ORDER BY s.full_name ASC, se.id ASC), ARRAY[]::uuid[])
      INTO v_alphabetical_order
    FROM student_enrollments se
    JOIN students s ON s.id = se.student_id
    WHERE se.class_id = v_class.class_id
      AND se.status = 'active'
      AND se.roll_number IS NOT NULL;

    -- Current order by existing roll_number.
    SELECT COALESCE(array_agg(se.student_id ORDER BY se.roll_number ASC), ARRAY[]::uuid[])
      INTO v_current_order
    FROM student_enrollments se
    WHERE se.class_id = v_class.class_id
      AND se.status = 'active'
      AND se.roll_number IS NOT NULL;

    -- If diverged (and non-empty), pin everyone in this class as manual.
    IF array_length(v_current_order, 1) IS NOT NULL
       AND v_current_order IS DISTINCT FROM v_alphabetical_order THEN
      UPDATE student_enrollments
         SET roll_number_manual = true
       WHERE class_id = v_class.class_id
         AND status = 'active'
         AND roll_number IS NOT NULL;
    END IF;
  END LOOP;
END $$;

DO $$
DECLARE
  v_class_id uuid;
BEGIN
  FOR v_class_id IN
    SELECT DISTINCT class_id
    FROM student_enrollments
    WHERE status = 'active'
  LOOP
    PERFORM recompute_roll_numbers(v_class_id, 'name');
  END LOOP;
END $$;
