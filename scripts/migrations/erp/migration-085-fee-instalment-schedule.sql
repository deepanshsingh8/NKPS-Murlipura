-- Migration 085 — instalment-based fee schedules.
--
-- The customer's fee schedule is a *row-per-instalment* grid, not one row per
-- fee head with a frequency multiplier:
--
--   S No | Fee Head      | Due Date   | Instalment Name           | Amount  | Student Type | Month Name  | Late Fee Start Date
--   1    | Admission Fee | 01/04/2026 | Admission/Regn. Fee       | 10500   | New Student  |             |
--   2    | Tuition Fee   | 01/04/2026 | 1st Instalment (Tuition)  | 23500   | Both         | April, 2026 | 12/07/2026
--   3    | Tuition Fee   | 01/10/2026 | 2nd Instalment (Tuition)  | 23500   | Both         | Oct., 2026  | 12/10/2026
--   4    | Tuition Fee   | 01/01/2027 | 3rd Instalment (Tuition)  | 23500   | Both         | Jan., 2027  | 12/01/2027
--
-- Nursery–X and XII carry one schedule per class; XI carries one per stream
-- (`stream_id`, already present since migration 012). The number of
-- instalments differs per class (3-instalment and 4-instalment plans are both
-- in use), so the schedule has to be an explicit list of rows rather than a
-- frequency the app multiplies out.
--
-- Rather than introduce a parallel `fee_schedule_items` table — which would
-- orphan every FK already pointing at `fee_structures` (fee_payments,
-- payment_orders, fee_change_requests, receipts, historical import) — each
-- grid row IS a `fee_structures` row with `frequency = 'one_time'`. The
-- annualized amount of a one_time row is the amount itself, so the existing
-- dues/expected math stays correct with no multiplier special-casing.
--
-- New columns:
--   instalment_no        — 1-based position within the schedule (NULL for
--                          legacy non-instalment rows). Drives S No ordering.
--   instalment_name      — free text shown on receipts and the parent portal,
--                          e.g. "1st Instalment (Tuition Fee)".
--   month_label          — the period the instalment covers, e.g. "April, 2026".
--                          Free text: the school writes "Oct., 2026", not a date.
--   student_type         — 'new' | 'existing' | 'both'. Admission/registration
--                          fees bill only students admitted in this academic
--                          year; tuition instalments bill everyone.
--   late_fee_start_date  — the grace anchor. Late fee accrues from this date,
--                          NOT from due_date (schedules routinely allow ~11
--                          days: due 01/04, late fee from 12/04). NULL falls
--                          back to due_date, preserving legacy behaviour.
--
-- Idempotent (IF NOT EXISTS + DROP/ADD CONSTRAINT).

ALTER TABLE fee_structures
  ADD COLUMN IF NOT EXISTS instalment_no smallint,
  ADD COLUMN IF NOT EXISTS instalment_name text,
  ADD COLUMN IF NOT EXISTS month_label text,
  ADD COLUMN IF NOT EXISTS student_type text NOT NULL DEFAULT 'both',
  ADD COLUMN IF NOT EXISTS late_fee_start_date date;

ALTER TABLE fee_structures DROP CONSTRAINT IF EXISTS fee_structures_student_type_check;
ALTER TABLE fee_structures ADD CONSTRAINT fee_structures_student_type_check
  CHECK (student_type IN ('new', 'existing', 'both'));

ALTER TABLE fee_structures DROP CONSTRAINT IF EXISTS fee_structures_instalment_no_positive;
ALTER TABLE fee_structures ADD CONSTRAINT fee_structures_instalment_no_positive
  CHECK (instalment_no IS NULL OR instalment_no > 0);

-- A grace date that precedes the due date would make the late fee start
-- accruing before the fee is even payable.
ALTER TABLE fee_structures DROP CONSTRAINT IF EXISTS fee_structures_late_fee_start_after_due;
ALTER TABLE fee_structures ADD CONSTRAINT fee_structures_late_fee_start_after_due
  CHECK (
    late_fee_start_date IS NULL
    OR due_date IS NULL
    OR late_fee_start_date >= due_date
  );

-- The schedule grid reads every row for one (year, class, stream) bucket and
-- renders them in due-date order.
CREATE INDEX IF NOT EXISTS idx_fee_structures_schedule
  ON fee_structures (academic_year_id, class_name, stream_id, due_date, instalment_no);
