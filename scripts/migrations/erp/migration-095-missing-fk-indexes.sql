-- migration-095-missing-fk-indexes.sql
--
-- Adds indexes on foreign-key columns that carry real query traffic but had
-- none. Postgres does NOT create an index for a FK constraint automatically —
-- only for PRIMARY KEY and UNIQUE. Every filter and join on these columns was
-- therefore a sequential scan, and every DELETE on the parent row scanned the
-- child table to check the constraint.
--
-- An audit of the schema found 27 unindexed FK columns. Most sit on small
-- master tables where a scan costs nothing and an index would only add write
-- overhead; those are deliberately left alone. The ones below were selected
-- because they are filtered or joined on hot paths, on tables that grow with
-- enrolment and time.
--
-- Purely additive and reversible: no table is rewritten, no behaviour changes,
-- and each statement is IF NOT EXISTS so the file is safe to re-run.
--
-- Note on CONCURRENTLY: omitted deliberately. CREATE INDEX CONCURRENTLY cannot
-- run inside a transaction block, and the Supabase SQL editor wraps submissions
-- in one. These tables are small enough at a single school's scale that the
-- brief write lock is not worth the operational complexity. For a large
-- existing dataset, run each statement separately with CONCURRENTLY added.

-- fee_payments: the largest transactional table. Every year-scoped fee query
-- (dues register, collection dashboard, receipts, reports) filters on this.
CREATE INDEX IF NOT EXISTS idx_fee_payments_academic_year_id
  ON fee_payments(academic_year_id);

-- class_tests: only created_by and is_published were indexed. The screen that
-- actually matters lists tests for one class, usually narrowed to a subject.
CREATE INDEX IF NOT EXISTS idx_class_tests_class_id
  ON class_tests(class_id);
CREATE INDEX IF NOT EXISTS idx_class_tests_subject_id
  ON class_tests(subject_id);

-- class_subjects: class_id and teacher_id were indexed, subject_id was not.
-- teacherTeachesClassSubject() and the subject-assignment screens both hit it.
CREATE INDEX IF NOT EXISTS idx_class_subjects_subject_id
  ON class_subjects(subject_id);

-- timetable_periods: indexed on (class_id, day_of_week) and teacher_id. The
-- substitution planner and subject-load views filter by subject.
CREATE INDEX IF NOT EXISTS idx_timetable_periods_subject_id
  ON timetable_periods(subject_id);

-- exam_schedules: covered for (exam_type_id, class_id) and exam_date, but a
-- per-subject lookup had nothing to use.
CREATE INDEX IF NOT EXISTS idx_exam_schedules_subject_id
  ON exam_schedules(subject_id);

-- student_enrollments: student_id, class_id, academic_year_id and status are
-- all indexed; stream_id was missed. Stream-filtered rosters are common in
-- XI-XII where streams exist at all.
CREATE INDEX IF NOT EXISTS idx_student_enrollments_stream_id
  ON student_enrollments(stream_id);

-- marksheet_publications: publish/finalize checks look up "is this exam type
-- published for this class", and only the published_by/unpublished_by actor
-- columns were indexed.
CREATE INDEX IF NOT EXISTS idx_marksheet_publications_exam_type_id
  ON marksheet_publications(exam_type_id);

-- student_status_history: written on every status change and read as a
-- per-student timeline; the year and class columns back the filtered views.
CREATE INDEX IF NOT EXISTS idx_student_status_history_academic_year_id
  ON student_status_history(academic_year_id);
CREATE INDEX IF NOT EXISTS idx_student_status_history_class_id
  ON student_status_history(class_id);
