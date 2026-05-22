-- Migration 048: Backfill fee_payments.academic_year_id from fee_structures.
--
-- The dues / no-dues compute (apps/erp/src/app/(admin)/fees/page.tsx,
-- computeDues) filters fee_payments by academic_year_id directly. The
-- POST /api/fees/payments and POST /api/fees/waivers handlers were
-- inserting rows without that column, so freshly recorded payments and
-- waivers vanished from the dues view (showed 0 paid out of total).
--
-- Both handlers now set academic_year_id explicitly. This migration
-- backfills the rows already in the database — every fee_payments row
-- has a fee_structure_id, and fee_structures.academic_year_id is NOT
-- NULL, so the join is unambiguous.

UPDATE fee_payments fp
SET academic_year_id = fs.academic_year_id
FROM fee_structures fs
WHERE fp.fee_structure_id = fs.id
  AND fp.academic_year_id IS NULL;
