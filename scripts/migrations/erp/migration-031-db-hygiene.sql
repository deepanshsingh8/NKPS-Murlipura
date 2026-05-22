-- Migration 031: data-integrity + perf hygiene from the audit.
--
-- Three buckets, all idempotent:
--  1. CHECK (> 0) on money / max-marks columns (L11) — last line of defense
--     when zod schemas miss a `.finite()` somewhere.
--  2. Missing BTREE indexes (M22) — audit FKs and is_published filters.
--  3. updated_at auto-touch triggers on Phase 4+ tables (M21) — so tables
--     gain `updated_at` momentum when admins edit them in-place.

-- ---------------------------------------------------------------------------
-- 1. CHECK (> 0) constraints on money / max-marks
-- ---------------------------------------------------------------------------

ALTER TABLE exam_types
  DROP CONSTRAINT IF EXISTS exam_types_max_marks_positive;
ALTER TABLE exam_types
  ADD CONSTRAINT exam_types_max_marks_positive
  CHECK (max_marks > 0);

ALTER TABLE fee_structures
  DROP CONSTRAINT IF EXISTS fee_structures_amount_positive;
ALTER TABLE fee_structures
  ADD CONSTRAINT fee_structures_amount_positive
  CHECK (amount > 0);

ALTER TABLE fee_payments
  DROP CONSTRAINT IF EXISTS fee_payments_amount_positive;
ALTER TABLE fee_payments
  ADD CONSTRAINT fee_payments_amount_positive
  CHECK (amount_paid > 0);

ALTER TABLE payment_orders
  DROP CONSTRAINT IF EXISTS payment_orders_amount_positive;
ALTER TABLE payment_orders
  ADD CONSTRAINT payment_orders_amount_positive
  CHECK (amount > 0);

-- ---------------------------------------------------------------------------
-- 2. Missing BTREE indexes
-- ---------------------------------------------------------------------------

-- Audit columns: who entered the row.
CREATE INDEX IF NOT EXISTS idx_results_entered_by
  ON results(entered_by);
CREATE INDEX IF NOT EXISTS idx_class_test_results_entered_by
  ON class_test_results(entered_by);
CREATE INDEX IF NOT EXISTS idx_non_scholastic_assessments_entered_by
  ON non_scholastic_assessments(entered_by);
CREATE INDEX IF NOT EXISTS idx_student_remarks_author_id
  ON student_remarks(author_id);
CREATE INDEX IF NOT EXISTS idx_class_tests_created_by
  ON class_tests(created_by);

-- Filter columns the student/parent portal hits a lot.
CREATE INDEX IF NOT EXISTS idx_results_is_published
  ON results(is_published)
  WHERE is_published = true;
CREATE INDEX IF NOT EXISTS idx_class_tests_is_published
  ON class_tests(is_published)
  WHERE is_published = true;

-- Cleanup queries for expired pending payment orders.
CREATE INDEX IF NOT EXISTS idx_payment_orders_expires_at
  ON payment_orders(expires_at);

-- ---------------------------------------------------------------------------
-- 3. updated_at trigger on Phase 4+ tables that have the column but no trigger.
--    Reuses the schema's existing `set_updated_at()` function.
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  t text;
  tables text[] := ARRAY[
    'gallery_events',
    'section_cards',
    'staff_members',
    'grade_scales',
    'class_exam_configs',
    'pdf_header_configs',
    'pdf_footer_configs',
    'non_scholastic_subjects',
    'non_scholastic_sub_subjects',
    'exam_schedules',
    'admit_card_templates',
    'result_masters',
    'class_tests',
    'student_remarks',
    'articles'
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    -- Skip silently if the table doesn't exist yet (older deployments).
    IF EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = t
    ) AND EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = t AND column_name = 'updated_at'
    ) THEN
      EXECUTE format(
        'DROP TRIGGER IF EXISTS %I ON %I',
        'set_updated_at_' || t,
        t
      );
      EXECUTE format(
        'CREATE TRIGGER %I BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION public.set_updated_at()',
        'set_updated_at_' || t,
        t
      );
    END IF;
  END LOOP;
END $$;
