-- Migration 052: Tag historical-import rows on results.
--
-- Mirrors migration 051 but for the `results` table. Bulk imports of
-- previous-year exam marks (during the transition off the old software)
-- need to be distinguishable from marks entered by teachers in the
-- live ERP workflow:
--   • audit trail ("imported from old system, not a teacher entry")
--   • one-shot revert of a faulty batch via import_batch_id
--   • optional UI badges / report filters
--
-- `source` defaults to 'erp_native' so every existing result row stays
-- valid without any backfill, and every new teacher-entered result is
-- correctly tagged. Historical importer sets source='historical_import'.
--
-- Idempotent — safe to re-run.

begin;

alter table results
  add column if not exists source text not null default 'erp_native'
    check (source in ('erp_native', 'historical_import'));

alter table results
  add column if not exists import_batch_id uuid;

create index if not exists results_import_batch_idx
  on results(import_batch_id)
  where import_batch_id is not null;

commit;
