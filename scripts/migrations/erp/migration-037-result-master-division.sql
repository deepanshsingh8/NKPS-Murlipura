-- Migration 037: Division labels (CBSE-style) on the year-end report card.
--
-- `show_division` is a per-class toggle. Default true matches the most common
-- CBSE convention. `division_scheme` is text but the CHECK constraint below
-- locks it to the single supported value. Adding a state-board variant is a
-- two-line follow-up migration: extend the CHECK and add the label set in
-- src/lib/final-result.ts. (Audit M8 — comment was inaccurate before.)

ALTER TABLE result_masters
  ADD COLUMN IF NOT EXISTS show_division boolean NOT NULL DEFAULT true;

ALTER TABLE result_masters
  ADD COLUMN IF NOT EXISTS division_scheme text NOT NULL DEFAULT 'cbse';

-- Track which schemes are currently understood. Adding a new value is a one-
-- liner DROP/ADD CONSTRAINT migration; until then 'cbse' is the only value.
ALTER TABLE result_masters DROP CONSTRAINT IF EXISTS result_masters_division_scheme_check;
ALTER TABLE result_masters ADD CONSTRAINT result_masters_division_scheme_check
  CHECK (division_scheme IN ('cbse'));
