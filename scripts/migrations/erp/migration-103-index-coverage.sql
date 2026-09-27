-- migration-103-index-coverage.sql
--
-- Additive index work only. Every statement here is CREATE INDEX IF NOT
-- EXISTS, so this migration cannot break a read path and is safe to re-run.
--
-- WHY ADDITIVE ONLY ------------------------------------------------------
-- The audit also found 34 redundant indexes (8 exact duplicates of an
-- implicit UNIQUE/PK index, 26 left-prefixes of a wider index). They are NOT
-- dropped here, deliberately.
--
-- supabase-schema.sql has been shown to drift from the live database:
-- migration-erp-redesign.sql renamed ~50 policies without updating the mirror,
-- and student_enrollments.pickup_address exists in migration-053 but appears
-- nowhere in the mirror. Dropping an index because a file says a wider one
-- covers it is exactly the kind of decision that must be made against the live
-- catalog, not against a file we know is stale. Dropping them also buys write
-- amplification and storage back - not read latency - so deferring costs
-- nothing on query speed. See the verification query at the bottom.
--
-- Postgres creates an index for PRIMARY KEY and UNIQUE automatically, but
-- NEVER for a foreign key. An unindexed FK means every DELETE of a parent row
-- sequentially scans the child table.
-- ─────────────────────────────────────────────────────────────────────────

BEGIN;

-- ── Tier 1: unindexed FKs on tables that grow without bound ──────────────
-- Every DELETE FROM profiles / buses / bus_stops currently seq-scans these.

-- transport_change_requests carries six unindexed FKs.
CREATE INDEX IF NOT EXISTS idx_tcr_requested_by      ON transport_change_requests(requested_by);
CREATE INDEX IF NOT EXISTS idx_tcr_reviewed_by       ON transport_change_requests(reviewed_by);
CREATE INDEX IF NOT EXISTS idx_tcr_previous_bus_id   ON transport_change_requests(previous_bus_id);
CREATE INDEX IF NOT EXISTS idx_tcr_amended_bus_id    ON transport_change_requests(amended_bus_id);
CREATE INDEX IF NOT EXISTS idx_tcr_previous_stop_id  ON transport_change_requests(previous_stop_id);
CREATE INDEX IF NOT EXISTS idx_tcr_amended_stop_id   ON transport_change_requests(amended_stop_id);

-- Append-only audit tables. migration-095 skipped these on the grounds that
-- they "sit on small master tables"; they are not master tables and they do
-- not stay small - student_status_history gains a row per student per
-- promotion run.
CREATE INDEX IF NOT EXISTS idx_student_enrollments_status_changed_by
  ON student_enrollments(status_changed_by);
CREATE INDEX IF NOT EXISTS idx_student_status_history_changed_by
  ON student_status_history(changed_by);
CREATE INDEX IF NOT EXISTS idx_teacher_absences_marked_by
  ON teacher_absences(marked_by);
CREATE INDEX IF NOT EXISTS idx_fee_change_requests_reviewed_by
  ON fee_change_requests(reviewed_by);
CREATE INDEX IF NOT EXISTS idx_historical_corrections_enrollment
  ON historical_corrections(enrollment_id);
CREATE INDEX IF NOT EXISTS idx_fee_change_audit_source_request
  ON fee_change_audit_log(source_request_id);

-- ── Tier 2: remaining unindexed join columns ─────────────────────────────
-- migration-095 added exam_schedules(subject_id) but missed class_id, which
-- is only ever the SECOND column of idx_exam_schedules_exam_class and so has
-- no leading index of its own.
CREATE INDEX IF NOT EXISTS idx_exam_schedules_class_id
  ON exam_schedules(class_id);
CREATE INDEX IF NOT EXISTS idx_result_masters_grade_scale_id
  ON result_masters(grade_scale_id);
CREATE INDEX IF NOT EXISTS idx_students_alumni_academic_year_id
  ON students(alumni_academic_year_id);
CREATE INDEX IF NOT EXISTS idx_export_events_academic_year_id
  ON export_events(academic_year_id);
CREATE INDEX IF NOT EXISTS idx_buses_conductor_id
  ON buses(conductor_id);
CREATE INDEX IF NOT EXISTS idx_elective_slot_options_subject_id
  ON elective_slot_options(subject_id);

-- ── Composites matching the query shapes the app actually issues ─────────
-- Each was cross-checked against the .eq()/.in()/.order() chains in apps/erp.

-- The hottest shape in the codebase: 15 call sites do
--   .eq("class_id", ...).eq("status","active").order("roll_number")
-- idx_enrollments_active is (student_id, class_id, academic_year_id) WHERE
-- status='active' - it leads with student_id, so a class-roster read cannot
-- use it and falls back to the single-column class_id index plus a sort.
CREATE INDEX IF NOT EXISTS idx_enrollments_class_status_roll
  ON student_enrollments(class_id, status, roll_number);

-- 14 sites: .eq(student_id)[.eq(academic_year_id)].order(enrollment_date DESC).
-- UNIQUE(student_id, class_id) cannot serve the ordering, so this sorts today.
CREATE INDEX IF NOT EXISTS idx_enrollments_student_year_date
  ON student_enrollments(student_id, academic_year_id, enrollment_date DESC);

-- 7 sites on the marksheet path. Only (class_id, subject_id) and a separate
-- (exam_type_id) exist, so neither serves this pair.
CREATE INDEX IF NOT EXISTS idx_results_class_exam
  ON results(class_id, exam_type_id);

-- 6 sites: the student fee ledger.
CREATE INDEX IF NOT EXISTS idx_fee_payments_student_year_date
  ON fee_payments(student_id, academic_year_id, payment_date DESC);

-- The two /api/students list endpoints, which order by full_name and split on
-- is_alumni. Partial so each index only carries the rows its endpoint reads.
CREATE INDEX IF NOT EXISTS idx_students_active_name
  ON students(full_name) WHERE is_alumni = false;
CREATE INDEX IF NOT EXISTS idx_students_alumni_year_name
  ON students(alumni_passing_year, full_name) WHERE is_alumni = true;

ANALYZE;

COMMIT;

-- ─────────────────────────────────────────────────────────────────────────
-- FOLLOW-UP: the 34 redundant indexes.
--
-- Run this against the LIVE database to confirm which are genuinely covered
-- before dropping anything. It lists every index whose column list is a
-- leading prefix of another index on the same table.
--
--   SELECT  n.nspname, c.relname AS table_name,
--           i1.relname AS redundant_index,
--           i2.relname AS covered_by
--     FROM  pg_index x1
--     JOIN  pg_class i1 ON i1.oid = x1.indexrelid
--     JOIN  pg_class c  ON c.oid  = x1.indrelid
--     JOIN  pg_namespace n ON n.oid = c.relnamespace
--     JOIN  pg_index x2 ON x2.indrelid = x1.indrelid
--                      AND x2.indexrelid <> x1.indexrelid
--     JOIN  pg_class i2 ON i2.oid = x2.indexrelid
--    WHERE  n.nspname = 'public'
--      AND  NOT x1.indisprimary AND NOT x1.indisunique
--      AND  x1.indpred IS NULL AND x2.indpred IS NULL
--      AND  array_to_string(x2.indkey,' ') LIKE array_to_string(x1.indkey,' ') || '%'
--    ORDER  BY 2, 3;
--
-- Anything this query returns is safe to DROP INDEX. Anything it does not
-- return is NOT redundant, whatever supabase-schema.sql implies.
-- ─────────────────────────────────────────────────────────────────────────
