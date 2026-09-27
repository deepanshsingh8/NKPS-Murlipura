-- Migration 117 — which subjects each teacher is qualified to teach.
--
-- ── Why ─────────────────────────────────────────────────────────────────────
-- Assigning Mathematics to VI-B today offers a dropdown of every teacher in
-- the school. The staff asked for the three maths teachers instead, and
-- correctly identified the missing piece: "this picture will be unlocked only
-- after one new option of subject assign to teachers." This table is that
-- option. Phase 3 is what turns it into the filtered dropdown.
--
-- ── Why not reuse class_subjects ────────────────────────────────────────────
-- class_subjects answers "who teaches Maths to VI-B" — one teacher per
-- (class, subject), scoped to a class. Competency is neither: a teacher can
-- know a subject they are not currently timetabled for, and three of them can
-- know the same one. Different question, different table.
--
-- SAFE TO RE-RUN.

BEGIN;

-- ─── 1. The table ───────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS teacher_subjects (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  teacher_id uuid REFERENCES teachers(id) ON DELETE CASCADE NOT NULL,
  subject_id uuid REFERENCES subjects(id) ON DELETE CASCADE NOT NULL,
  created_at timestamptz DEFAULT now(),
  UNIQUE(teacher_id, subject_id)
);

COMMENT ON TABLE teacher_subjects IS
  'Which subjects a teacher is qualified to teach. Drives the "teachers of '
  'this subject first" ordering in the assign-subject dropdown. Distinct from '
  'class_subjects, which records who actually teaches a subject in one class.';

CREATE INDEX IF NOT EXISTS idx_teacher_subjects_teacher
  ON teacher_subjects(teacher_id);
CREATE INDEX IF NOT EXISTS idx_teacher_subjects_subject
  ON teacher_subjects(subject_id);

-- ─── 2. RLS ─────────────────────────────────────────────────────────────────
-- Authenticated read, NOT the `USING (true)` with no TO clause that
-- class_subjects and stream_subjects carry. Those are keyed on class / stream
-- / subject and contain no person. This table is keyed on teacher_id, so an
-- anon read would enumerate every teacher UUID in the school — the same shape
-- of leak migration 098 was written to close on `teachers` itself.
-- student_subjects sets the precedent for the person-keyed case.
--
-- Writes are admin-only here; editors reach the table through the admin proxy,
-- which gates on the `subjects` feature key. Same arrangement as
-- class_subjects and stream_subjects.

ALTER TABLE teacher_subjects ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated can read teacher_subjects" ON teacher_subjects;
CREATE POLICY "Authenticated can read teacher_subjects"
  ON teacher_subjects FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS "Admins manage teacher_subjects" ON teacher_subjects;
CREATE POLICY "Admins manage teacher_subjects"
  ON teacher_subjects FOR ALL
  USING (public.get_user_role() = 'admin')
  WITH CHECK (public.get_user_role() = 'admin');

-- ─── 3. Seed from what the system already knows ─────────────────────────────
-- Both sources are needed. api/substitutions/suggest reads both for exactly
-- this reason and says why: "in practice class_subjects.teacher_id is often
-- unpopulated — teachers are assigned via the timetable instead". Seeding from
-- class_subjects alone would leave much of the staff with no subjects at all,
-- and the filtered dropdown would filter nothing.
--
-- NOT seeded from staff_members.subject. It is free text holding things like
-- 'Biology', 'Principal' and 'Mother Teacher'; name-matching it against the
-- subject catalogue would invent competencies that quietly mis-filter the
-- dropdown. A missing entry an admin can tick is better than a wrong one
-- nobody notices.

INSERT INTO teacher_subjects (teacher_id, subject_id)
SELECT DISTINCT cs.teacher_id, cs.subject_id
FROM class_subjects cs
WHERE cs.teacher_id IS NOT NULL
ON CONFLICT (teacher_id, subject_id) DO NOTHING;

INSERT INTO teacher_subjects (teacher_id, subject_id)
SELECT DISTINCT tp.teacher_id, tp.subject_id
FROM timetable_periods tp
WHERE tp.teacher_id IS NOT NULL
  AND tp.subject_id IS NOT NULL
  AND tp.is_break IS NOT TRUE
ON CONFLICT (teacher_id, subject_id) DO NOTHING;

-- ─── 4. Keep it current ─────────────────────────────────────────────────────
-- class_subjects.teacher_id is written from at least five places (the Assign
-- dialog, the Change-Teacher dialog, /api/subjects/bulk-assign,
-- /api/subjects/quick-setup, and the class-assignments route added in the next
-- phase), and adminApi() is a single-table proxy that cannot carry a side
-- effect. So the rule lives here, where every writer passes through it.
--
-- Add-only, on purpose. Un-assigning a teacher from VI-B Maths does not mean
-- they stopped knowing Maths, and a delete-side trigger would also erase
-- competencies an admin ticked by hand.
--
-- Deliberately not on timetable_periods: that table is used for the one-time
-- seed above but not for ongoing learning. Its shape changes later in this
-- work, and a trigger there would buy a little accuracy for real risk.

CREATE OR REPLACE FUNCTION public.trg_learn_teacher_subject()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.subject_id IS NOT NULL THEN
    INSERT INTO public.teacher_subjects (teacher_id, subject_id)
    VALUES (NEW.teacher_id, NEW.subject_id)
    ON CONFLICT (teacher_id, subject_id) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS class_subject_learns_teacher_subject ON class_subjects;
CREATE TRIGGER class_subject_learns_teacher_subject
  AFTER INSERT OR UPDATE OF teacher_id ON class_subjects
  FOR EACH ROW
  WHEN (NEW.teacher_id IS NOT NULL)
  EXECUTE FUNCTION public.trg_learn_teacher_subject();

COMMIT;
