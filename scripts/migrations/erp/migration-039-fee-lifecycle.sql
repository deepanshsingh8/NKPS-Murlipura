-- Migration 039: Fee lifecycle (waiver / refund / partial / late-fee).
--
-- Adds the columns needed to make the existing payment-status enum
-- (paid/partial/failed/refunded) actually usable from the admin UI:
--
--   fee_structures
--     late_fee_percent       — overdue surcharge as % of `amount`
--     late_fee_fixed_amount  — overdue surcharge as a flat sum
--   fee_payments
--     waiver_amount          — when payment_method='waiver', the amount
--                              waived (the corresponding amount_paid stays 0)
--     waiver_reason          — required when payment_method='waiver'
--     refund_amount          — when status='refunded', amount returned to payer
--     refund_reason          — required when status='refunded'
--     refunded_at, refunded_by — audit timestamps
--
-- Also extends payment_method to include 'waiver' (a paper trail entry that
-- counts toward "no dues" without requiring an actual cash receipt).
--
-- All idempotent so re-running is safe.

ALTER TABLE fee_structures
  ADD COLUMN IF NOT EXISTS late_fee_percent numeric(5,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS late_fee_fixed_amount numeric(10,2) NOT NULL DEFAULT 0;

ALTER TABLE fee_structures DROP CONSTRAINT IF EXISTS fee_structures_late_fee_percent_range;
ALTER TABLE fee_structures ADD CONSTRAINT fee_structures_late_fee_percent_range
  CHECK (late_fee_percent >= 0 AND late_fee_percent <= 100);

ALTER TABLE fee_structures DROP CONSTRAINT IF EXISTS fee_structures_late_fee_fixed_nonneg;
ALTER TABLE fee_structures ADD CONSTRAINT fee_structures_late_fee_fixed_nonneg
  CHECK (late_fee_fixed_amount >= 0);

ALTER TABLE fee_payments
  ADD COLUMN IF NOT EXISTS waiver_amount numeric(10,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS waiver_reason text,
  ADD COLUMN IF NOT EXISTS refund_amount numeric(10,2),
  ADD COLUMN IF NOT EXISTS refund_reason text,
  ADD COLUMN IF NOT EXISTS refunded_at timestamptz,
  ADD COLUMN IF NOT EXISTS refunded_by uuid REFERENCES profiles(id) ON DELETE SET NULL;

ALTER TABLE fee_payments DROP CONSTRAINT IF EXISTS fee_payments_waiver_amount_nonneg;
ALTER TABLE fee_payments ADD CONSTRAINT fee_payments_waiver_amount_nonneg
  CHECK (waiver_amount >= 0);

ALTER TABLE fee_payments DROP CONSTRAINT IF EXISTS fee_payments_refund_consistent;
ALTER TABLE fee_payments ADD CONSTRAINT fee_payments_refund_consistent
  CHECK (
    (status = 'refunded' AND refund_amount IS NOT NULL AND refund_amount > 0)
    OR (status <> 'refunded' AND refunded_at IS NULL AND refund_amount IS NULL)
  );

-- Extend payment_method to recognize 'waiver'. The CHECK constraint must be
-- replaced wholesale; values stay backwards-compatible.
ALTER TABLE fee_payments DROP CONSTRAINT IF EXISTS fee_payments_payment_method_check;
ALTER TABLE fee_payments ADD CONSTRAINT fee_payments_payment_method_check
  CHECK (
    payment_method IN (
      'cash', 'online', 'cheque', 'bank_transfer', 'upi', 'gateway', 'waiver'
    )
  );

-- Sanity link: when the row is a waiver, amount_paid should be 0 and
-- waiver_amount + waiver_reason must be set.
ALTER TABLE fee_payments DROP CONSTRAINT IF EXISTS fee_payments_waiver_consistent;
ALTER TABLE fee_payments ADD CONSTRAINT fee_payments_waiver_consistent
  CHECK (
    (payment_method = 'waiver'
      AND amount_paid = 0
      AND waiver_amount > 0
      AND waiver_reason IS NOT NULL
      AND length(waiver_reason) > 0)
    OR payment_method <> 'waiver'
  );

CREATE INDEX IF NOT EXISTS idx_fee_payments_refund_status
  ON fee_payments(status)
  WHERE status = 'refunded';
