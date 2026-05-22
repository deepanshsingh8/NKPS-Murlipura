-- Migration 018: Per-exam class level + weightage scoping.
--
-- Schools configure different exam schemes for different year-groups:
-- junior classes typically have fewer exams (e.g. Half-Yearly + Annual),
-- senior classes more (unit tests + half-yearly + pre-board + board).
-- Rather than a per-individual-class config (which grows unwieldy at 20+
-- classes) we scope an exam_type to a class level, mirroring the
-- FeeClassLevel taxonomy already used on fee_structures.
--
-- The `weightage` column on exam_types becomes meaningful per (academic_year,
-- class_level): all exam_types for a given year+level should sum to 100%,
-- validated client-side with a visible coverage indicator. A class_level of
-- 'all' means the exam contributes to every level's total (e.g. a school-
-- wide event counted uniformly). The existing class_exam_configs table
-- remains as a per-class override layer for rare exceptions.

ALTER TABLE exam_types
  ADD COLUMN IF NOT EXISTS class_level text NOT NULL DEFAULT 'all';

ALTER TABLE exam_types
  DROP CONSTRAINT IF EXISTS exam_types_class_level_check;
ALTER TABLE exam_types
  ADD CONSTRAINT exam_types_class_level_check
  CHECK (class_level IN ('all', 'nursery_ukg', 'i_v', 'vi_viii', 'ix_x', 'xi_xii'));

CREATE INDEX IF NOT EXISTS idx_exam_types_year_level
  ON exam_types(academic_year_id, class_level);
