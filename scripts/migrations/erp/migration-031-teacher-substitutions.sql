-- Migration 030: Teacher absences + substitutions.
--
-- Planning layer on top of the existing `timetable_periods` table (which
-- already models the regular weekly schedule). Two new tables:
--
--   teacher_absences  — one row per teacher per date they're absent.
--                       Optional half_day flag for partial-day absences
--                       (medical appointments, school duties, etc.)
--   substitutions     — one row per (absence × affected period) once an
--                       admin assigns a substitute teacher. Absence of a row
--                       for an affected period means "not yet assigned" —
--                       there is no separate `pending` state.
--
-- Why we use timetable_periods.id (not class_id+period_number) as the link
-- to the affected period: classes run on STAGGERED schedules in this school
-- (verified empirically — see scripts/_check-period-times.mjs), so the
-- substitute-availability algorithm matches by time-range overlap, not by
-- period_number. Using the period UUID gives us a single stable join target
-- that already encodes (class_id, day_of_week, period_number, start_time,
-- end_time) without us having to re-encode it in the substitutions row.
--
-- Idempotent: safe to re-run.

-- ─── 1. teacher_absences ────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS teacher_absences (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  teacher_id uuid NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
  absence_date date NOT NULL,
  half_day text NOT NULL DEFAULT 'full'
    CHECK (half_day IN ('full', 'first_half', 'second_half')),
  reason text,
  marked_by uuid REFERENCES profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (teacher_id, absence_date)
);

CREATE INDEX IF NOT EXISTS idx_teacher_absences_date
  ON teacher_absences(absence_date);

CREATE INDEX IF NOT EXISTS idx_teacher_absences_teacher
  ON teacher_absences(teacher_id);

-- ─── 2. substitutions ───────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS substitutions (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  absence_id uuid NOT NULL REFERENCES teacher_absences(id) ON DELETE CASCADE,
  timetable_period_id uuid NOT NULL REFERENCES timetable_periods(id) ON DELETE CASCADE,
  -- Nullable so deleting a teacher (rare; usually soft-deleted via is_active)
  -- doesn't wipe the historical substitution record.
  substitute_teacher_id uuid REFERENCES teachers(id) ON DELETE SET NULL,
  note text,
  assigned_by uuid REFERENCES profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (absence_id, timetable_period_id)
);

CREATE INDEX IF NOT EXISTS idx_substitutions_absence
  ON substitutions(absence_id);

CREATE INDEX IF NOT EXISTS idx_substitutions_substitute_teacher
  ON substitutions(substitute_teacher_id);

CREATE INDEX IF NOT EXISTS idx_substitutions_period
  ON substitutions(timetable_period_id);

-- ─── 3. updated_at triggers ─────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.teacher_absences_touch_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS teacher_absences_set_updated_at ON teacher_absences;
CREATE TRIGGER teacher_absences_set_updated_at
  BEFORE UPDATE ON teacher_absences
  FOR EACH ROW EXECUTE FUNCTION public.teacher_absences_touch_updated_at();

CREATE OR REPLACE FUNCTION public.substitutions_touch_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS substitutions_set_updated_at ON substitutions;
CREATE TRIGGER substitutions_set_updated_at
  BEFORE UPDATE ON substitutions
  FOR EACH ROW EXECUTE FUNCTION public.substitutions_touch_updated_at();

-- ─── 4. RLS ─────────────────────────────────────────────────────────────────
-- Defense-in-depth. The actual access gate is in the API layer
-- (verifyAdminOrEditor("teacher_substitutions") + service-role client which
-- bypasses RLS). These policies block direct browser-client access to
-- sensitive HR data (absence reasons) and let admins query directly via
-- the Supabase dashboard.

ALTER TABLE teacher_absences ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins manage teacher_absences" ON teacher_absences;
CREATE POLICY "Admins manage teacher_absences"
  ON teacher_absences FOR ALL
  USING (public.get_user_role() = 'admin')
  WITH CHECK (public.get_user_role() = 'admin');

ALTER TABLE substitutions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins manage substitutions" ON substitutions;
CREATE POLICY "Admins manage substitutions"
  ON substitutions FOR ALL
  USING (public.get_user_role() = 'admin')
  WITH CHECK (public.get_user_role() = 'admin');
