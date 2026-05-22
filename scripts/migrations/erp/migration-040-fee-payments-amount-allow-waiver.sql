-- Migration 040: Relax fee_payments_amount_positive so waiver rows fit.
--
-- Migration 031 added `fee_payments_amount_positive CHECK (amount_paid > 0)`.
-- Migration 039 introduced waivers as a fee_payments row with
-- `payment_method='waiver'` AND `amount_paid = 0` AND `waiver_amount > 0`.
-- The two constraints are mutually exclusive — every "Record Waiver" insert
-- raises 23514. This migration replaces the strict check with one that
-- allows the waiver case while still rejecting any other zero/negative row.

ALTER TABLE fee_payments DROP CONSTRAINT IF EXISTS fee_payments_amount_positive;

ALTER TABLE fee_payments ADD CONSTRAINT fee_payments_amount_positive
  CHECK (
    (payment_method = 'waiver' AND amount_paid = 0)
    OR amount_paid > 0
  );
