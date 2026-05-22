-- =============================================================
-- Migration 002: Fix RLS policies for teacher access via class_subjects
-- =============================================================
-- CONTEXT: Teachers are assigned to classes in two ways:
-- 1. As class_teacher_id on the classes table
-- 2. Via class_subjects (teaching specific subjects in a class)
--
-- Current RLS only checks path #1 for most tables. Teachers assigned
-- via path #2 can see the class in their dropdown but get empty results
-- when querying enrollments, attendance, or results.
-- =============================================================

-- ---------------------------------------------------------------
-- student_enrollments: allow teachers with class_subjects access
-- ---------------------------------------------------------------
DROP POLICY IF EXISTS "Teachers can read enrollments for their subject classes" ON student_enrollments;

CREATE POLICY "Teachers can read enrollments for their subject classes"
  ON student_enrollments FOR SELECT
  USING (
    public.get_user_role() = 'teacher'
    AND class_id IN (
      SELECT cs.class_id FROM class_subjects cs WHERE cs.teacher_id = auth.uid()
    )
  );

-- ---------------------------------------------------------------
-- attendance: allow teachers with class_subjects access
-- ---------------------------------------------------------------
-- SELECT
DROP POLICY IF EXISTS "Teachers can read attendance via class_subjects" ON attendance;

CREATE POLICY "Teachers can read attendance via class_subjects"
  ON attendance FOR SELECT
  USING (
    public.get_user_role() = 'teacher'
    AND class_id IN (
      SELECT cs.class_id FROM class_subjects cs WHERE cs.teacher_id = auth.uid()
    )
  );

-- INSERT
DROP POLICY IF EXISTS "Teachers can insert attendance via class_subjects" ON attendance;

CREATE POLICY "Teachers can insert attendance via class_subjects"
  ON attendance FOR INSERT
  WITH CHECK (
    public.get_user_role() = 'teacher'
    AND class_id IN (
      SELECT cs.class_id FROM class_subjects cs WHERE cs.teacher_id = auth.uid()
    )
  );

-- UPDATE
DROP POLICY IF EXISTS "Teachers can update attendance via class_subjects" ON attendance;

CREATE POLICY "Teachers can update attendance via class_subjects"
  ON attendance FOR UPDATE
  USING (
    public.get_user_role() = 'teacher'
    AND class_id IN (
      SELECT cs.class_id FROM class_subjects cs WHERE cs.teacher_id = auth.uid()
    )
  );

-- ---------------------------------------------------------------
-- results: fix SELECT to include subject-teachers, relax INSERT/UPDATE
-- ---------------------------------------------------------------
-- The existing SELECT policy only checks class_teacher_id.
-- The existing INSERT/UPDATE require BOTH class_teacher_id AND class_subjects match.
-- Fix: allow either path for all operations.

DROP POLICY IF EXISTS "Teachers can read results via class_subjects" ON results;

CREATE POLICY "Teachers can read results via class_subjects"
  ON results FOR SELECT
  USING (
    public.get_user_role() = 'teacher'
    AND (
      class_id IN (SELECT cs.class_id FROM class_subjects cs WHERE cs.teacher_id = auth.uid())
      AND subject_id IN (SELECT cs.subject_id FROM class_subjects cs WHERE cs.teacher_id = auth.uid())
    )
  );

-- INSERT: a teacher can insert results for subjects they teach in that class
DROP POLICY IF EXISTS "Teachers can insert results via class_subjects" ON results;

CREATE POLICY "Teachers can insert results via class_subjects"
  ON results FOR INSERT
  WITH CHECK (
    public.get_user_role() = 'teacher'
    AND class_id IN (SELECT cs.class_id FROM class_subjects cs WHERE cs.teacher_id = auth.uid())
    AND subject_id IN (SELECT cs.subject_id FROM class_subjects cs WHERE cs.teacher_id = auth.uid())
  );

-- UPDATE: same as insert
DROP POLICY IF EXISTS "Teachers can update results via class_subjects" ON results;

CREATE POLICY "Teachers can update results via class_subjects"
  ON results FOR UPDATE
  USING (
    public.get_user_role() = 'teacher'
    AND class_id IN (SELECT cs.class_id FROM class_subjects cs WHERE cs.teacher_id = auth.uid())
    AND subject_id IN (SELECT cs.subject_id FROM class_subjects cs WHERE cs.teacher_id = auth.uid())
  );

-- ---------------------------------------------------------------
-- Ensure transfer_certificates public SELECT policy exists
-- ---------------------------------------------------------------
DROP POLICY IF EXISTS "Public can view transfer certificates" ON transfer_certificates;

CREATE POLICY "Public can view transfer certificates"
  ON transfer_certificates FOR SELECT
  USING (true);

-- ---------------------------------------------------------------
-- calendar_events: ensure public read access
-- ---------------------------------------------------------------
DROP POLICY IF EXISTS "Public can read calendar events" ON calendar_events;

CREATE POLICY "Public can read calendar events"
  ON calendar_events FOR SELECT
  USING (true);
