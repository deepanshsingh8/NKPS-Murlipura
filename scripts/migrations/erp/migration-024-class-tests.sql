-- Migration 024: Class Tests (dedicated module).
-- Sibling of exam_types — separate table so teachers can create, edit, and
-- grade class tests independently of the Term Exam calendar. The existing
-- `exam_types.kind='class_test'` lightweight path still works for schools
-- that prefer to fold class tests into the main exam list; the two coexist.
--
-- Integration with Result Master (migration-022) is deferred: `weightage` is
-- recorded here but not yet consumed by final-result.ts. When we want
-- class_test_results to contribute to the final result, the engine can read
-- from this table alongside the existing results table.
--
-- Note: `term_id` from the original Phase 3 spec was dropped because Phase 4
-- shipped without a `terms` table (intentional deviation — composition is
-- driven by weightages, not terms).

CREATE TABLE IF NOT EXISTS class_tests (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  class_id uuid NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  subject_id uuid NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
  name text NOT NULL,
  test_date date,
  max_marks numeric(5,2) NOT NULL DEFAULT 100,
  weightage numeric(5,2),
  is_published boolean NOT NULL DEFAULT false,
  created_by uuid REFERENCES profiles(id),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  CONSTRAINT class_tests_max_marks_positive CHECK (max_marks > 0),
  CONSTRAINT class_tests_weightage_pct CHECK (
    weightage IS NULL OR (weightage >= 0 AND weightage <= 100)
  )
);

CREATE INDEX IF NOT EXISTS idx_class_tests_class_subject
  ON class_tests(class_id, subject_id);
CREATE INDEX IF NOT EXISTS idx_class_tests_class
  ON class_tests(class_id);
CREATE INDEX IF NOT EXISTS idx_class_tests_date
  ON class_tests(test_date);

CREATE TABLE IF NOT EXISTS class_test_results (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  class_test_id uuid NOT NULL REFERENCES class_tests(id) ON DELETE CASCADE,
  student_id uuid NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  marks_obtained numeric(5,2) NOT NULL,
  max_marks numeric(5,2) NOT NULL,
  grade text,
  remarks text,
  entered_by uuid NOT NULL REFERENCES profiles(id),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  CONSTRAINT class_test_results_unique UNIQUE (class_test_id, student_id),
  CONSTRAINT class_test_results_marks_in_range CHECK (
    marks_obtained >= 0 AND marks_obtained <= max_marks
  )
);

CREATE INDEX IF NOT EXISTS idx_class_test_results_test
  ON class_test_results(class_test_id);
CREATE INDEX IF NOT EXISTS idx_class_test_results_student
  ON class_test_results(student_id);

-- ── RLS: class_tests ────────────────────────────────────────────────────────

ALTER TABLE class_tests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins full access to class_tests" ON class_tests;
CREATE POLICY "Admins full access to class_tests"
  ON class_tests FOR ALL
  USING (public.get_user_role() = 'admin');

DROP POLICY IF EXISTS "Teachers can read class_tests for their classes" ON class_tests;
CREATE POLICY "Teachers can read class_tests for their classes"
  ON class_tests FOR SELECT
  USING (
    public.get_user_role() = 'teacher'
    AND class_id IN (SELECT public.get_my_class_ids())
  );

DROP POLICY IF EXISTS "Teachers can insert class_tests for their class-subject combos" ON class_tests;
CREATE POLICY "Teachers can insert class_tests for their class-subject combos"
  ON class_tests FOR INSERT
  WITH CHECK (
    public.get_user_role() = 'teacher'
    AND class_id IN (SELECT public.get_my_class_ids())
    AND subject_id IN (
      SELECT subject_id FROM class_subjects WHERE teacher_id = public.get_my_teacher_id()
    )
  );

DROP POLICY IF EXISTS "Teachers can update class_tests for their class-subject combos" ON class_tests;
CREATE POLICY "Teachers can update class_tests for their class-subject combos"
  ON class_tests FOR UPDATE
  USING (
    public.get_user_role() = 'teacher'
    AND class_id IN (SELECT public.get_my_class_ids())
    AND subject_id IN (
      SELECT subject_id FROM class_subjects WHERE teacher_id = public.get_my_teacher_id()
    )
  );

DROP POLICY IF EXISTS "Teachers can delete class_tests for their class-subject combos" ON class_tests;
CREATE POLICY "Teachers can delete class_tests for their class-subject combos"
  ON class_tests FOR DELETE
  USING (
    public.get_user_role() = 'teacher'
    AND class_id IN (SELECT public.get_my_class_ids())
    AND subject_id IN (
      SELECT subject_id FROM class_subjects WHERE teacher_id = public.get_my_teacher_id()
    )
  );

DROP POLICY IF EXISTS "Students can read own published class_tests" ON class_tests;
CREATE POLICY "Students can read own published class_tests"
  ON class_tests FOR SELECT
  USING (
    is_published = true
    AND class_id IN (
      SELECT class_id FROM student_enrollments
      WHERE student_id = public.get_my_student_id()
        AND status = 'active'
    )
  );

DROP POLICY IF EXISTS "Parents can read children published class_tests" ON class_tests;
CREATE POLICY "Parents can read children published class_tests"
  ON class_tests FOR SELECT
  USING (
    is_published = true
    AND class_id IN (
      SELECT class_id FROM student_enrollments
      WHERE student_id IN (SELECT public.get_my_children_ids())
        AND status = 'active'
    )
  );

-- ── RLS: class_test_results ─────────────────────────────────────────────────

ALTER TABLE class_test_results ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins full access to class_test_results" ON class_test_results;
CREATE POLICY "Admins full access to class_test_results"
  ON class_test_results FOR ALL
  USING (public.get_user_role() = 'admin');

DROP POLICY IF EXISTS "Teachers can read class_test_results for their classes" ON class_test_results;
CREATE POLICY "Teachers can read class_test_results for their classes"
  ON class_test_results FOR SELECT
  USING (
    public.get_user_role() = 'teacher'
    AND class_test_id IN (
      SELECT id FROM class_tests
      WHERE class_id IN (SELECT public.get_my_class_ids())
    )
  );

DROP POLICY IF EXISTS "Teachers can insert class_test_results for their class-subject combos" ON class_test_results;
CREATE POLICY "Teachers can insert class_test_results for their class-subject combos"
  ON class_test_results FOR INSERT
  WITH CHECK (
    public.get_user_role() = 'teacher'
    AND class_test_id IN (
      SELECT id FROM class_tests
      WHERE class_id IN (SELECT public.get_my_class_ids())
        AND subject_id IN (
          SELECT subject_id FROM class_subjects WHERE teacher_id = public.get_my_teacher_id()
        )
    )
  );

DROP POLICY IF EXISTS "Teachers can update class_test_results for their class-subject combos" ON class_test_results;
CREATE POLICY "Teachers can update class_test_results for their class-subject combos"
  ON class_test_results FOR UPDATE
  USING (
    public.get_user_role() = 'teacher'
    AND class_test_id IN (
      SELECT id FROM class_tests
      WHERE class_id IN (SELECT public.get_my_class_ids())
        AND subject_id IN (
          SELECT subject_id FROM class_subjects WHERE teacher_id = public.get_my_teacher_id()
        )
    )
  );

DROP POLICY IF EXISTS "Students can read own published class_test_results" ON class_test_results;
CREATE POLICY "Students can read own published class_test_results"
  ON class_test_results FOR SELECT
  USING (
    student_id = public.get_my_student_id()
    AND class_test_id IN (SELECT id FROM class_tests WHERE is_published = true)
  );

DROP POLICY IF EXISTS "Parents can read children published class_test_results" ON class_test_results;
CREATE POLICY "Parents can read children published class_test_results"
  ON class_test_results FOR SELECT
  USING (
    student_id IN (SELECT public.get_my_children_ids())
    AND class_test_id IN (SELECT id FROM class_tests WHERE is_published = true)
  );
