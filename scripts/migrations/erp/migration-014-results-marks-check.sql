-- Migration 014: Enforce marks_obtained bounds on results.
-- Last line of defense: DB rejects rows where marks are out of range,
-- regardless of what any API caller or future CSV importer sends.

-- Pre-flight (run this first if you suspect any legacy bad rows; if it
-- returns any rows, clean them before applying the ALTER below, otherwise
-- the constraint add will abort):
--
-- SELECT r.id, r.marks_obtained, r.max_marks,
--        s.admission_no, s.full_name,
--        sub.name AS subject, e.name AS exam
-- FROM results r
-- JOIN students s   ON s.id = r.student_id
-- JOIN subjects sub ON sub.id = r.subject_id
-- JOIN exam_types e ON e.id = r.exam_type_id
-- WHERE r.marks_obtained < 0 OR r.marks_obtained > r.max_marks;

ALTER TABLE results
  DROP CONSTRAINT IF EXISTS results_marks_in_range;

ALTER TABLE results
  ADD CONSTRAINT results_marks_in_range
  CHECK (marks_obtained >= 0 AND marks_obtained <= max_marks);
