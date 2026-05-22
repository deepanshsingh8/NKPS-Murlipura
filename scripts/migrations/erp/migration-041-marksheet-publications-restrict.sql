-- Migration 041: Stop marksheet_publications from cascading on exam type or
-- academic year delete.
--
-- Marksheet snapshots are an audit-quality artifact — once finalized, they
-- represent the school's permanent record of what was published to a parent.
-- Letting `DELETE FROM exam_types WHERE id=...` or `DELETE FROM academic_years
-- WHERE id=...` silently wipe those snapshots defeats the entire purpose of
-- the table. The new posture is RESTRICT: admins must unpublish the
-- snapshots first, then delete the parent row.
--
-- (We keep CASCADE on `students` and `classes` because deleting a student or
-- a class IS expected to remove their finalized rows — the school is
-- removing that record from the system entirely. The exam-type / academic-
-- year cases are different — those rows are reference data, not the subject
-- of the snapshot.)

ALTER TABLE marksheet_publications
  DROP CONSTRAINT IF EXISTS marksheet_publications_exam_type_id_fkey;
ALTER TABLE marksheet_publications
  ADD CONSTRAINT marksheet_publications_exam_type_id_fkey
  FOREIGN KEY (exam_type_id) REFERENCES exam_types(id) ON DELETE RESTRICT;

ALTER TABLE marksheet_publications
  DROP CONSTRAINT IF EXISTS marksheet_publications_academic_year_id_fkey;
ALTER TABLE marksheet_publications
  ADD CONSTRAINT marksheet_publications_academic_year_id_fkey
  FOREIGN KEY (academic_year_id) REFERENCES academic_years(id) ON DELETE RESTRICT;

-- Mirror change for publish_events.exam_type_id while we're here (M15 in
-- audit round 2). publish_events is purely an audit log; cascading the row
-- away because the source exam was deleted defeats the audit.
ALTER TABLE publish_events
  DROP CONSTRAINT IF EXISTS publish_events_exam_type_id_fkey;
ALTER TABLE publish_events
  ADD CONSTRAINT publish_events_exam_type_id_fkey
  FOREIGN KEY (exam_type_id) REFERENCES exam_types(id) ON DELETE SET NULL;
