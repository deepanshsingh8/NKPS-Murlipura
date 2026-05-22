-- Migration 044 — Capture payment-method-specific details on fee_payments.
--
-- Cash receipts need nothing extra. The other methods used to lose the
-- only fields the school actually cares about for reconciliation:
--
--   * cheque         → cheque number, cheque date, drawee bank
--   * bank_transfer  → originating bank, payer name, transaction reference
--   * online / upi   → payment provider (PhonePe/GPay/Paytm/Razorpay/etc.)
--                      and transaction reference (UTR / order id)
--
-- Existing rows are left as-is; new entries collect these via the
-- record-payment dialog and the receipt PDF surfaces them on the slip.
-- Validation lives in the API + form; we deliberately skip a CHECK
-- constraint here so historical receipts (entered before this migration)
-- don't become invalid retroactively.

ALTER TABLE fee_payments
  ADD COLUMN IF NOT EXISTS cheque_number    text,
  ADD COLUMN IF NOT EXISTS cheque_date      date,
  ADD COLUMN IF NOT EXISTS bank_name        text,
  ADD COLUMN IF NOT EXISTS payer_name       text,
  ADD COLUMN IF NOT EXISTS transaction_ref  text,
  ADD COLUMN IF NOT EXISTS payment_provider text;

COMMENT ON COLUMN fee_payments.cheque_number IS
  'Cheque instrument number. Required when payment_method=cheque (enforced in API).';
COMMENT ON COLUMN fee_payments.cheque_date IS
  'Date written on the cheque (often differs from payment_date).';
COMMENT ON COLUMN fee_payments.bank_name IS
  'Drawee bank for cheques; originating bank for bank_transfer.';
COMMENT ON COLUMN fee_payments.payer_name IS
  'Name on the instrument or transfer; defaults to student/father if blank.';
COMMENT ON COLUMN fee_payments.transaction_ref IS
  'UTR / NEFT ref / UPI txn id / gateway-side reference for manual online entries.';
COMMENT ON COLUMN fee_payments.payment_provider IS
  'Free-text label for the channel (PhonePe, GPay, Paytm, Razorpay, etc.).';
