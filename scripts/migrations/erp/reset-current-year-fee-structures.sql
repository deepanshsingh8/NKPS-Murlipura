-- Reset the CURRENT academic year's fee structures so schedules can be
-- rebuilt from scratch in Academic Fees → Fee Schedule.
--
-- NOT a migration. Nothing runs this automatically — paste the block you want
-- into the Supabase SQL editor. It exists because the rows carried over from
-- the pre-085 recurring model (one "quarterly" row per class) can't be edited
-- into a published instalment schedule row-by-row; starting the year over is
-- cleaner.
--
-- Rows that a receipt or a payment order points at are NEVER deleted here.
-- Deleting one would orphan a receipt the school has already issued, and both
-- FKs are NOT NULL so Postgres would reject it anyway. Those rows are
-- deactivated instead: they stop counting toward dues and stop appearing in
-- the schedule grid, while every receipt still resolves.
--
-- Run step 1, read the output, then run step 2 (and 3 only if step 1 showed
-- rows with receipts).

-- ---------------------------------------------------------------------------
-- STEP 1 — Preview. What exists today, and what is safe to delete.
-- ---------------------------------------------------------------------------
SELECT
  fs.class_name,
  fs.fee_type,
  fs.amount,
  fs.frequency,
  fs.due_date,
  fs.instalment_name,
  fs.is_active,
  (SELECT count(*) FROM fee_payments p WHERE p.fee_structure_id = fs.id)
    AS receipts,
  (SELECT count(*) FROM payment_orders o WHERE o.fee_structure_id = fs.id)
    AS payment_orders,
  CASE
    WHEN EXISTS (SELECT 1 FROM fee_payments p WHERE p.fee_structure_id = fs.id)
      OR EXISTS (SELECT 1 FROM payment_orders o WHERE o.fee_structure_id = fs.id)
    THEN 'kept — will be deactivated'
    ELSE 'will be deleted'
  END AS outcome
FROM fee_structures fs
JOIN academic_years ay ON ay.id = fs.academic_year_id
WHERE ay.is_current
ORDER BY fs.class_name, fs.due_date NULLS LAST, fs.fee_type;

-- ---------------------------------------------------------------------------
-- STEP 2 — Delete the current year's fee structures that nothing references.
-- ---------------------------------------------------------------------------
DELETE FROM fee_structures fs
USING academic_years ay
WHERE ay.id = fs.academic_year_id
  AND ay.is_current
  AND NOT EXISTS (
    SELECT 1 FROM fee_payments p WHERE p.fee_structure_id = fs.id
  )
  AND NOT EXISTS (
    SELECT 1 FROM payment_orders o WHERE o.fee_structure_id = fs.id
  );

-- ---------------------------------------------------------------------------
-- STEP 3 — Retire the ones that survived because they carry receipts.
-- Only needed if STEP 1 listed rows as "kept — will be deactivated".
-- ---------------------------------------------------------------------------
UPDATE fee_structures fs
SET is_active = false
FROM academic_years ay
WHERE ay.id = fs.academic_year_id
  AND ay.is_current
  AND fs.is_active;

-- ---------------------------------------------------------------------------
-- Verify: this should return no active rows for the current year.
-- ---------------------------------------------------------------------------
-- SELECT fs.class_name, fs.fee_type, fs.amount
-- FROM fee_structures fs
-- JOIN academic_years ay ON ay.id = fs.academic_year_id
-- WHERE ay.is_current AND fs.is_active;
