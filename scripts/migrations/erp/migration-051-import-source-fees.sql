-- Migration 051: Tag historical-import rows on fee_payments.
--
-- The school is migrating from a previous fee-management software. Bulk
-- imports (CSV/XLSX) of legacy payment logs must be distinguishable from
-- payments recorded natively in this ERP, so that:
--   • the audit trail stays clear ("this record came from the old system"),
--   • a faulty import can be reverted in one shot via its batch id,
--   • UI/reporting can optionally filter or badge migrated rows.
--
-- `source` defaults to 'erp_native' so every existing payment stays valid
-- without any backfill, and every new natively-recorded payment is correctly
-- tagged. Bulk-import code sets source='historical_import' explicitly.
--
-- `import_batch_id` groups every row inserted in a single bulk upload.
-- Indexed for fast revert queries.
--
-- Idempotent — safe to re-run.

begin;

alter table fee_payments
  add column if not exists source text not null default 'erp_native'
    check (source in ('erp_native', 'historical_import'));

alter table fee_payments
  add column if not exists import_batch_id uuid;

create index if not exists fee_payments_import_batch_idx
  on fee_payments(import_batch_id)
  where import_batch_id is not null;

commit;
