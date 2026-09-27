-- migration-115-day-book-import.sql
--
-- Backfill support for the previous ERP software's "Day Book Head wise Report":
-- one row per receipt, with head-wise amount columns, the tender type, and the
-- instrument details. Session 2026-27 was collected entirely in that software
-- until this import runs, so until it does every collection figure, dues
-- register and no-dues gate in this ERP is wrong.
--
-- ── Numbering ───────────────────────────────────────────────────────────────
-- 110-113 are a reserved block for the AI feature; 114 is ai_chat_history.
-- 115 is the next free number across every module folder. Re-run the check
-- before adding a file, because parallel branches both grab "next":
--   ls scripts/migrations/*/ | grep -oE 'migration-[0-9]+' | sort | uniq -d
--
--
-- ── Why source_receipt_no, when receipt_number is already UNIQUE ────────────
-- The importer splits one old receipt across the instalments it settles, so a
-- single source receipt becomes 1..N fee_payments rows. The obvious key is a
-- suffixed receipt_number ("DB-2026-1242-1", "-2"), and it is the wrong one:
-- the split depends on the fee schedule at import time. Edit an instalment
-- amount between two imports and the same money re-splits under different
-- suffixes, so the second upload inserts a duplicate set instead of
-- conflicting with the first. On an overlapping re-export -- which is the
-- normal case, since the school re-exports the day book as the year goes on --
-- that silently doubles the collection.
--
-- source_receipt_no records the old software's own receipt number, which never
-- changes. The unique index below is what makes a re-upload idempotent no
-- matter how the schedule moved, and it is scoped by academic year because the
-- old software restarts its receipt series each session.
--
-- COALESCE(fee_structure_id, bus_stop_id) rather than fee_structure_id alone:
-- fee_payments_target_xor (migration 074) means exactly one of the two is set,
-- and a transport day book -- the export that comes next -- lands on
-- bus_stop_id with fee_structure_id NULL. NULLs compare distinct in a unique
-- index, so keying on fee_structure_id would leave those rows undeduplicated.
--
--
-- ── Why import_batches ─────────────────────────────────────────────────────
-- Batch tracking today is a bare import_batch_id uuid on fee_payments, results
-- and student_enrollments, minted at commit and shown once in a toast. Nothing
-- records what the batch was, who ran it or whether it was reverted, and the
-- two revert endpoints have no UI because there is nowhere to list batches
-- from. That was survivable for a one-shot backfill of a closed year. It is
-- not survivable for a ledger that will be re-imported repeatedly through a
-- live session and holds two crore rupees.
--
-- Deliberately NOT an FK from fee_payments.import_batch_id: rows already
-- carrying batch ids have no parent, and ON DELETE semantics would then decide
-- the fate of receipts. The backfill at the end of this file gives the
-- existing batches a parent row so the history list is not blank on day one,
-- but the column stays a plain indexed uuid -- the same shape results and
-- student_enrollments already use.

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. fee_payments.source_receipt_no
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE fee_payments
  ADD COLUMN IF NOT EXISTS source_receipt_no text;

COMMENT ON COLUMN fee_payments.source_receipt_no IS
  'Receipt number as printed by the previous ERP software. Stable across '
  're-imports (unlike receipt_number, whose slice suffix moves when the fee '
  'schedule changes), so it is the idempotency key for the day-book importer '
  'and the number the office searches by.';

CREATE UNIQUE INDEX IF NOT EXISTS fee_payments_source_receipt_unique
  ON fee_payments (
    academic_year_id,
    source_receipt_no,
    COALESCE(fee_structure_id, bus_stop_id)
  )
  WHERE source_receipt_no IS NOT NULL;

-- Lookup path for "show me old receipt 1242" and for the dry run's
-- already-imported classification, which probes by year + receipt number.
-- The Day Book records one instrument date for every non-cash receipt: the
-- date on the cheque, or the date the online transfer went through. Both land
-- in cheque_date, so widen what the column claims to mean. Nothing reads it as
-- cheque-only -- the receipt PDF prints it beside whichever reference the row
-- carries.
COMMENT ON COLUMN fee_payments.cheque_date IS
  'Date on the payment instrument: the date written on the cheque, or the '
  'date an online transfer/UTR was executed. Often differs from payment_date, '
  'which is always the date the school received the money.';

CREATE INDEX IF NOT EXISTS idx_fee_payments_source_receipt
  ON fee_payments (academic_year_id, source_receipt_no)
  WHERE source_receipt_no IS NOT NULL;

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. import_batches
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS import_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- What kind of file produced this batch. Determines which table the revert
  -- endpoint deletes from, so it is a CHECK rather than free text.
  kind text NOT NULL CHECK (kind IN (
    'fees_day_book',
    'fees_account_wise',
    'results_greensheet',
    'students_backfill'
  )),

  academic_year_id uuid REFERENCES academic_years(id) ON DELETE SET NULL,

  file_name        text,
  file_size_bytes  integer CHECK (file_size_bytes IS NULL OR file_size_bytes >= 0),

  -- The period the source report itself covers, parsed from its title line.
  -- Two exports of overlapping periods are the expected case; this is what
  -- lets an admin see that at a glance.
  source_period_start date,
  source_period_end   date,

  row_count      integer NOT NULL DEFAULT 0 CHECK (row_count >= 0),
  created_count  integer NOT NULL DEFAULT 0 CHECK (created_count >= 0),
  skipped_count  integer NOT NULL DEFAULT 0 CHECK (skipped_count >= 0),
  amount_total   numeric(14, 2),

  -- The source file's own footer totals plus what we actually wrote, kept
  -- together so a reconciliation can be re-read months later without the
  -- original spreadsheet.
  control_totals jsonb,

  notes      text,
  created_by uuid REFERENCES profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),

  reverted_at timestamptz,
  reverted_by uuid REFERENCES profiles(id) ON DELETE SET NULL,

  CONSTRAINT import_batches_revert_consistent CHECK (
    (reverted_at IS NULL AND reverted_by IS NULL)
    OR reverted_at IS NOT NULL
  ),

  CONSTRAINT import_batches_period_ordered CHECK (
    source_period_start IS NULL
    OR source_period_end IS NULL
    OR source_period_end >= source_period_start
  )
);

CREATE INDEX IF NOT EXISTS idx_import_batches_kind_created
  ON import_batches (kind, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_import_batches_academic_year
  ON import_batches (academic_year_id);

CREATE INDEX IF NOT EXISTS idx_import_batches_created_by
  ON import_batches (created_by);

CREATE INDEX IF NOT EXISTS idx_import_batches_reverted_by
  ON import_batches (reverted_by);

-- Admin-only. Editors with the 'fees' grant may run an import (the API gates
-- that with verifyAdminOrEditor), but the batch registry is the audit trail
-- for it and reverting is admin-only, so nothing below service role reads or
-- writes this table directly.
ALTER TABLE import_batches ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins have full access to import batches" ON import_batches;
CREATE POLICY "Admins have full access to import batches"
  ON import_batches FOR ALL
  USING (public.get_user_role() = 'admin')
  WITH CHECK (public.get_user_role() = 'admin');

-- ═══════════════════════════════════════════════════════════════════════════
-- 3. Backfill parents for batches that already exist
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Counts and totals are recomputed from the rows themselves. file_name and
-- created_at are unknowable after the fact: created_at falls back to the
-- earliest row's created_at, which is the commit moment to within a second.

INSERT INTO import_batches (
  id, kind, academic_year_id, row_count, created_count, amount_total,
  notes, created_by, created_at
)
-- (array_agg(...))[1] rather than min(): min/max are declared per type in
-- pg_aggregate and uuid is not somewhere to rely on that. This also picks the
-- FIRST row of the batch, which is what "the year this batch ran against"
-- actually means, where min() would have picked the lowest uuid.
SELECT
  fp.import_batch_id,
  'fees_account_wise',
  (array_agg(fp.academic_year_id ORDER BY fp.created_at))[1],
  COUNT(*),
  COUNT(*),
  SUM(fp.amount_paid),
  'Reconstructed by migration 115 from the payment rows. The original file '
    || 'name and exact commit time were never recorded.',
  (array_agg(fp.recorded_by ORDER BY fp.created_at))[1],
  COALESCE(MIN(fp.created_at), now())
FROM fee_payments fp
WHERE fp.import_batch_id IS NOT NULL
  AND fp.source = 'historical_import'
GROUP BY fp.import_batch_id
ON CONFLICT (id) DO NOTHING;

INSERT INTO import_batches (
  id, kind, academic_year_id, row_count, created_count, notes, created_at
)
-- `results` carries no academic_year_id of its own; the year hangs off the
-- exam type the marks were entered against.
SELECT
  r.import_batch_id,
  'results_greensheet',
  (array_agg(et.academic_year_id ORDER BY r.created_at))[1],
  COUNT(*),
  COUNT(*),
  'Reconstructed by migration 115 from the result rows. The original file '
    || 'name and exact commit time were never recorded.',
  COALESCE(MIN(r.created_at), now())
FROM results r
JOIN exam_types et ON et.id = r.exam_type_id
WHERE r.import_batch_id IS NOT NULL
  AND r.source = 'historical_import'
GROUP BY r.import_batch_id
ON CONFLICT (id) DO NOTHING;

INSERT INTO import_batches (
  id, kind, academic_year_id, row_count, created_count, notes, created_at
)
SELECT
  se.import_batch_id,
  'students_backfill',
  (array_agg(se.academic_year_id ORDER BY se.created_at))[1],
  COUNT(*),
  COUNT(*),
  'Reconstructed by migration 115 from the enrollment rows. The original '
    || 'file name and exact commit time were never recorded.',
  COALESCE(MIN(se.created_at), now())
FROM student_enrollments se
WHERE se.import_batch_id IS NOT NULL
  -- Only the student bulk importer's own batches. Enrollments tagged
  -- 'historical_import' were created by the results importer and share its
  -- batch id, which the previous statement has already registered.
  AND se.source = 'bulk_backfill'
GROUP BY se.import_batch_id
ON CONFLICT (id) DO NOTHING;
