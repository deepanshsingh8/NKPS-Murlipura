-- Migration 054: extend fee_payments.payment_method to allow 'historical_unknown'.
--
-- The bulk-import flow ingests payment rows from the school's previous ERP
-- software. Those exports record the amount, date, and a receipt number but
-- never the channel (cash / cheque / UPI / etc.). Rather than guess a method
-- per row (which would corrupt the audit trail) or default to 'cash' (which
-- would inflate cash totals in reports), we introduce a dedicated value:
--
--   'historical_unknown' — "this came from the previous software; the method
--   was not recorded at the time."
--
-- This keeps imported rows distinguishable in reports and lets admins later
-- edit individual rows to a real method as they verify them with the parent.
-- The CHECK constraint must be replaced wholesale (Postgres doesn't support
-- adding values to an inline CHECK), so we drop and re-add it including every
-- existing value plus the new one.
--
-- Idempotent — safe to re-run; uses IF EXISTS / IF NOT EXISTS.

begin;

alter table fee_payments drop constraint if exists fee_payments_payment_method_check;
alter table fee_payments add constraint fee_payments_payment_method_check
  check (
    payment_method in (
      'cash',
      'online',
      'cheque',
      'bank_transfer',
      'upi',
      'gateway',
      'waiver',
      'historical_unknown'
    )
  );

commit;
