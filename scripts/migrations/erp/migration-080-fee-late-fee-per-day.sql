-- Migration 080 — per-day late fee (with optional cap) for fee structures.
--
-- The one-time surcharge model (late_fee_percent / late_fee_fixed_amount from
-- migration 039) couldn't express "₹X for every day past the due date", which
-- is how NKPS actually levies late fees (due dates: 10 Apr / Jul / Oct / Jan).
--
-- Adds:
--   late_fee_per_day — flat ₹ charged once per day elapsed since due_date
--   late_fee_max     — optional ceiling on the accrued late fee (NULL = uncapped)
--
-- The dues calc (admin Fees → Dues) now uses:
--   min( max(amount * late_fee_percent/100, daysOverdue * late_fee_per_day),
--        COALESCE(late_fee_max, Infinity) )
-- per overdue structure. late_fee_fixed_amount is retained for historical rows
-- but is no longer read by the calc or surfaced in the form.
--
-- Idempotent (IF NOT EXISTS + DROP/ADD CONSTRAINT).

ALTER TABLE fee_structures
  ADD COLUMN IF NOT EXISTS late_fee_per_day numeric(10,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS late_fee_max numeric(10,2);

ALTER TABLE fee_structures DROP CONSTRAINT IF EXISTS fee_structures_late_fee_per_day_nonneg;
ALTER TABLE fee_structures ADD CONSTRAINT fee_structures_late_fee_per_day_nonneg
  CHECK (late_fee_per_day >= 0);

ALTER TABLE fee_structures DROP CONSTRAINT IF EXISTS fee_structures_late_fee_max_nonneg;
ALTER TABLE fee_structures ADD CONSTRAINT fee_structures_late_fee_max_nonneg
  CHECK (late_fee_max IS NULL OR late_fee_max >= 0);
