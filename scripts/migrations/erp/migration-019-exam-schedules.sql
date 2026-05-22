-- Migration 019: Exam schedules (subject × class × date × time × room per exam).
-- Distinct from `timetable_periods` which models regular daily class periods.
-- The admit card (Phase 1.3) embeds the schedule rows for the student's class.

CREATE TABLE IF NOT EXISTS exam_schedules (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  exam_type_id uuid NOT NULL REFERENCES exam_types(id) ON DELETE CASCADE,
  class_id uuid NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  subject_id uuid NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
  exam_date date NOT NULL,
  start_time time,
  end_time time,
  room text,
  invigilator_teacher_id uuid REFERENCES teachers(id) ON DELETE SET NULL,
  sort_order integer NOT NULL DEFAULT 0,
  notes text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  CONSTRAINT exam_schedules_unique UNIQUE (exam_type_id, class_id, subject_id),
  CONSTRAINT exam_schedules_time_order CHECK (
    start_time IS NULL OR end_time IS NULL OR start_time < end_time
  )
);

CREATE INDEX IF NOT EXISTS idx_exam_schedules_exam_class
  ON exam_schedules(exam_type_id, class_id);
CREATE INDEX IF NOT EXISTS idx_exam_schedules_date ON exam_schedules(exam_date);

ALTER TABLE exam_schedules ENABLE ROW LEVEL SECURITY;

-- Everyone authenticated can read (students + parents need to see their schedule
-- through the admit card flow). Admin + editors with `exam_timetable` permission
-- manage rows.
DROP POLICY IF EXISTS "Authenticated can read exam_schedules" ON exam_schedules;
CREATE POLICY "Authenticated can read exam_schedules"
  ON exam_schedules FOR SELECT
  USING (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "Admins can manage exam_schedules" ON exam_schedules;
CREATE POLICY "Admins can manage exam_schedules"
  ON exam_schedules FOR ALL
  USING (
    EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role = 'admin')
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role = 'admin')
  );
