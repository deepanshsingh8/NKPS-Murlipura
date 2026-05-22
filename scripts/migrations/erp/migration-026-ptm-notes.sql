-- Migration 026: Parent-Teacher Meeting notes (Phase 6 Chunk B).
--
-- Two sibling tables:
--   1. `ptm_notes` — one row per (student, meeting_date). Records meeting
--      attendance plus teacher/parent remarks and action points. Teachers
--      create & edit; parents read their own children's notes.
--   2. `school_meeting_counts` — the "Total School Meetings" counter that
--      the legacy platform shows at the top of the PTM grid. Scoped by
--      (academic_year, optional exam_type, optional class) so a school can
--      track year-wide, per-exam, or per-class meeting tallies. Uniqueness
--      over nullable scope columns is enforced via a COALESCE'd unique
--      index (regular UNIQUE constraints can't express this in Postgres).
--
-- RLS in summary:
--   - admins: full access.
--   - teachers: read/write rows for students in their class scope
--     (`public.get_my_class_ids()`).
--   - parents: read-only for their own children (`get_my_children_ids()`).
--   - editors with `ptm_notes` feature key: enforced at the API layer via
--     verifyAdminOrEditor (matches the pattern used by Phase 2/3/5
--     features — SQL-level RLS doesn't know about editor_permissions).

-- =============================================================
-- ptm_notes
-- =============================================================

CREATE TABLE IF NOT EXISTS ptm_notes (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  student_id uuid NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  exam_type_id uuid REFERENCES exam_types(id) ON DELETE SET NULL,
  meeting_date date NOT NULL,
  attendance text NOT NULL,
  teacher_remarks text,
  parent_remarks text,
  action_points text,
  recorded_by uuid REFERENCES profiles(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),

  CONSTRAINT ptm_notes_attendance_check
    CHECK (attendance IN ('present', 'absent')),
  CONSTRAINT ptm_notes_unique_per_date UNIQUE (student_id, meeting_date)
);

CREATE INDEX IF NOT EXISTS idx_ptm_notes_student ON ptm_notes(student_id);
CREATE INDEX IF NOT EXISTS idx_ptm_notes_exam ON ptm_notes(exam_type_id);
CREATE INDEX IF NOT EXISTS idx_ptm_notes_date ON ptm_notes(meeting_date DESC);

-- Trigger: refresh updated_at on update.
CREATE OR REPLACE FUNCTION public.ptm_notes_touch_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS ptm_notes_set_updated_at ON ptm_notes;
CREATE TRIGGER ptm_notes_set_updated_at
  BEFORE UPDATE ON ptm_notes
  FOR EACH ROW EXECUTE FUNCTION public.ptm_notes_touch_updated_at();

ALTER TABLE ptm_notes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins manage ptm_notes" ON ptm_notes;
CREATE POLICY "Admins manage ptm_notes"
  ON ptm_notes FOR ALL
  USING (
    EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role = 'admin')
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role = 'admin')
  );

DROP POLICY IF EXISTS "Teachers read ptm_notes for own classes" ON ptm_notes;
CREATE POLICY "Teachers read ptm_notes for own classes"
  ON ptm_notes FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM student_enrollments se
      WHERE se.student_id = ptm_notes.student_id
        AND se.status = 'active'
        AND se.class_id IN (SELECT public.get_my_class_ids())
    )
  );

DROP POLICY IF EXISTS "Teachers write ptm_notes for own classes" ON ptm_notes;
CREATE POLICY "Teachers write ptm_notes for own classes"
  ON ptm_notes FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM student_enrollments se
      WHERE se.student_id = ptm_notes.student_id
        AND se.status = 'active'
        AND se.class_id IN (SELECT public.get_my_class_ids())
    )
  );

DROP POLICY IF EXISTS "Teachers update ptm_notes for own classes" ON ptm_notes;
CREATE POLICY "Teachers update ptm_notes for own classes"
  ON ptm_notes FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM student_enrollments se
      WHERE se.student_id = ptm_notes.student_id
        AND se.status = 'active'
        AND se.class_id IN (SELECT public.get_my_class_ids())
    )
  );

DROP POLICY IF EXISTS "Teachers delete ptm_notes for own classes" ON ptm_notes;
CREATE POLICY "Teachers delete ptm_notes for own classes"
  ON ptm_notes FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM student_enrollments se
      WHERE se.student_id = ptm_notes.student_id
        AND se.status = 'active'
        AND se.class_id IN (SELECT public.get_my_class_ids())
    )
  );

DROP POLICY IF EXISTS "Parents read ptm_notes for own children" ON ptm_notes;
CREATE POLICY "Parents read ptm_notes for own children"
  ON ptm_notes FOR SELECT
  USING (student_id IN (SELECT public.get_my_children_ids()));

-- =============================================================
-- school_meeting_counts
-- =============================================================

CREATE TABLE IF NOT EXISTS school_meeting_counts (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  academic_year_id uuid NOT NULL REFERENCES academic_years(id) ON DELETE CASCADE,
  exam_type_id uuid REFERENCES exam_types(id) ON DELETE CASCADE,
  class_id uuid REFERENCES classes(id) ON DELETE CASCADE,
  total_meetings integer NOT NULL DEFAULT 0,
  updated_at timestamptz DEFAULT now(),

  CONSTRAINT school_meeting_counts_nonneg CHECK (total_meetings >= 0)
);

-- Uniqueness over nullable scope keys: treat NULL as a sentinel so
-- (year, NULL, NULL) and (year, exam_X, NULL) coexist but duplicates
-- within either slot are rejected.
CREATE UNIQUE INDEX IF NOT EXISTS school_meeting_counts_scope_unique
  ON school_meeting_counts(
    academic_year_id,
    COALESCE(exam_type_id, '00000000-0000-0000-0000-000000000000'::uuid),
    COALESCE(class_id, '00000000-0000-0000-0000-000000000000'::uuid)
  );

CREATE INDEX IF NOT EXISTS idx_school_meeting_counts_year
  ON school_meeting_counts(academic_year_id);

DROP TRIGGER IF EXISTS school_meeting_counts_set_updated_at ON school_meeting_counts;
CREATE TRIGGER school_meeting_counts_set_updated_at
  BEFORE UPDATE ON school_meeting_counts
  FOR EACH ROW EXECUTE FUNCTION public.ptm_notes_touch_updated_at();

ALTER TABLE school_meeting_counts ENABLE ROW LEVEL SECURITY;

-- Readable by any authenticated user — the counter is displayed on teacher
-- and parent screens alike and has no PII.
DROP POLICY IF EXISTS "Authenticated read school_meeting_counts" ON school_meeting_counts;
CREATE POLICY "Authenticated read school_meeting_counts"
  ON school_meeting_counts FOR SELECT
  USING (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "Admins manage school_meeting_counts" ON school_meeting_counts;
CREATE POLICY "Admins manage school_meeting_counts"
  ON school_meeting_counts FOR ALL
  USING (
    EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role = 'admin')
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role = 'admin')
  );

DROP POLICY IF EXISTS "Teachers manage school_meeting_counts for own classes" ON school_meeting_counts;
CREATE POLICY "Teachers manage school_meeting_counts for own classes"
  ON school_meeting_counts FOR ALL
  USING (
    -- Year-wide / school-wide rows (class_id NULL) allowed for any teacher
    -- since they reflect institution-level meeting totals.
    class_id IS NULL
    OR class_id IN (SELECT public.get_my_class_ids())
  )
  WITH CHECK (
    class_id IS NULL
    OR class_id IN (SELECT public.get_my_class_ids())
  );
