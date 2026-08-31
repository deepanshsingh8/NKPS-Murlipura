-- =====================================================================
-- CONSOLIDATED MIGRATION — ERP + CMS sync with NKPS upstream (August 2026)
-- =====================================================================
-- Upstream: github.com/deepanshsingh8/NKPS @ 00ac881 (2026-08-16)
--
-- Runs AFTER CONSOLIDATED-erp-cms-upstream-sync.sql (the July sync). If that
-- one was never run, run it first.
--
-- Run ONCE, top to bottom, in the Supabase SQL editor for the Murlipura
-- project. Every statement is idempotent and safe to re-run.
--
-- The three sections below are the upstream migration files verbatim, in
-- dependency order (ERP before CMS), with one Murlipura addition noted inline
-- in the 086 section.
--
--   084 — restore student-data SELECT for the 'staff' role (additive RLS)
--   085 — instalment-based fee schedules on fee_structures
--   086 — allow the student_council / house_captains section types
--
-- DELIBERATELY EXCLUDED
--   erp/reset-current-year-fee-structures.sql — upstream files it under
--   migrations, but its own header says it is NOT one. It deletes and
--   deactivates fee-structure rows. Run it by hand, deliberately, only if you
--   want to rebuild the current year's schedules from scratch.
--
-- >>> Run against a backup / staging copy first if you can, then production. <<<
-- =====================================================================

-- =====================================================================
-- WRONG-DATABASE GUARD — do not remove.
-- =====================================================================
-- This script targets the **NKPS Murlipura** Supabase project only. The
-- parent NKPS (Rajawas) project is a separate database with its own
-- migration history, and the two dashboards look identical — pasting into
-- the wrong tab is an easy mistake to make.
--
-- `holiday_homework` and `prospectus_documents` back Murlipura-only CMS
-- features with no upstream equivalent, so their presence identifies this
-- database. If they are absent this raises, and because it sits above every
-- statement in the file, the script aborts without changing anything.
-- =====================================================================
do $$
begin
  if to_regclass('public.holiday_homework') is null
     or to_regclass('public.prospectus_documents') is null then
    raise exception
      'WRONG DATABASE - aborted, nothing was changed. This script targets the NKPS Murlipura project, but the Murlipura-only tables holiday_homework / prospectus_documents were not found. Switch projects in the Supabase dashboard and re-run.';
  end if;
end $$;



-- #####################################################################
-- ### 084 — erp/migration-084-staff-student-read-rls.sql
-- #####################################################################
-- Migration 084: restore student-data reads for the 'staff' role.
--
-- Migration 047 turned "editor" from a role into a capability: every profile
-- with role='editor' was backfilled to role='staff', and the CHECK constraint
-- was narrowed to (admin, staff, teacher, student, parent). So no row can hold
-- role='editor' any more.
--
-- 047 rewrote two policies that named the dead role ('profiles' and
-- 'student_remarks') but missed the rest. Policies still written as
--
--     USING (public.get_user_role() IN ('admin', 'editor'))
--
-- therefore match admins and nobody else. The visible symptom: a staff member
-- granted a feature (e.g. 'transport') passes the middleware page gate, the
-- page renders, and then every browser-side read of student data comes back
-- empty — RLS filters rows silently rather than erroring, so the UI shows its
-- "nothing found" empty state instead of a permission message.
--
-- Reported against /transport/assignments ("No enrollments found for the
-- active academic year"), but it hits every admin-area page that reads
-- students or enrollments through the browser client: attendance, exams,
-- results, fees, class tests, transport. Pages that read through an API route
-- were unaffected — those use the service-role client, which bypasses RLS.
--
-- Fix: grant the 'staff' role SELECT via ADDITIVE policies. RLS policies are
-- OR'd, so this restores the intent of the pre-047 'editor' grant without
-- having to know which historical policy names a given deployment carries
-- (the names differ between supabase-schema.sql and migration-erp-redesign).
--
-- Per-feature gating is unchanged and still happens in the application layer
-- (verifyAdminOrEditor / the middleware page gate). Consistent with 047's
-- stated design: "RLS stays role-coarse so policy bodies stay fast."
--
-- Deliberately NOT included: 'parents' and 'student_parents' carry the same
-- dead 'editor' reference, but no admin-area page reads them through the
-- browser client (only /parent/* pages, which match on their own policies,
-- and API routes, which bypass RLS). Left alone to avoid widening access to
-- guardian contact data for no working feature. Revisit if a staff-facing
-- screen ever needs them.
--
-- 'teachers' is not affected: teachers_select_authenticated already covers it.

begin;

-- ----- students -----
drop policy if exists "students_select_staff" on students;
create policy "students_select_staff"
  on students for select
  using (public.get_user_role() = 'staff');

-- ----- student_enrollments -----
-- Needed on top of students: the transport screen embeds students(...) under
-- an enrollments query, and PostgREST applies RLS to both the parent rows and
-- the embedded resource.
drop policy if exists "student_enrollments_select_staff" on student_enrollments;
create policy "student_enrollments_select_staff"
  on student_enrollments for select
  using (public.get_user_role() = 'staff');

commit;


-- #####################################################################
-- ### 085 — erp/migration-085-fee-instalment-schedule.sql
-- #####################################################################
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


-- #####################################################################
-- ### 086 — cms/migration-086-student-council-sections.sql
-- #####################################################################
-- MURLIPURA NOTE: the July consolidated script retired the 'latest_updates'
-- section (deleted its rows, dropped it from the constraint) and no app code
-- renders it. Upstream's allow-list below is a strict superset of that final
-- set, so nothing is lost. The defensive delete added just below the `begin;`
-- exists only so this script still succeeds on a database where the July
-- script was never run and stray rows survive.
-- #####################################################################
-- Migration 086: Student Council & House Captains sections (Student Life page)
-- Adds two CMS-managed section types for the annual investiture ceremony:
--
--   student_council — the school-level appointments (Head Boy, Head Girl,
--                     Sports Captain, Cultural Captain, …). Fields used:
--                     name (student), designation (post), role (class &
--                     section), year (session, e.g. 2026-27), message
--                     (optional line from the student), image_url (photo).
--
--   house_captains  — the per-house appointments. Same fields, plus `title`
--                     which carries the HOUSE NAME. The website groups the
--                     cards by `title`, so every captain of a house shares one
--                     panel and the house colour is derived from its name.
--
-- Both render on /student-life directly under the page header, so the current
-- office bearers are the first thing a visiting student sees.
--
-- 1. Widen the section_cards CHECK constraint to permit the two new sections
--    (keeping every previously-allowed value, incl. 'sports_indoor' /
--    'sports_outdoor' from migration 067 and 'student_achievements' from 065).
-- 2. No seed rows. These cards name real, currently-serving students, so
--    placeholder names must never reach the public site — the sections stay
--    hidden on the website until an admin adds cards via
--    Site Media → Student Life Page → Student Council / House Captains.
--    Cards added there are non-default, so admins can freely add AND delete
--    them each time a new council is invested.
-- Idempotent.

begin;

-- Murlipura: see the note above. No-op on an up-to-date database.
delete from section_cards where section = 'latest_updates';

-- 1. Replace any existing CHECK constraint on the `section` column (discovered
--    dynamically) with the full, widened allow-list.
do $$
declare
  c record;
begin
  for c in
    select con.conname
    from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
    where rel.relname = 'section_cards'
      and con.contype = 'c'
      and pg_get_constraintdef(con.oid) ilike '%section%'
  loop
    execute format('alter table section_cards drop constraint %I', c.conname);
  end loop;
end $$;

alter table section_cards add constraint section_cards_section_check
  check (section in (
    'hero_slider', 'testimonials', 'facilities_preview', 'leadership',
    'legacy_timeline', 'why_choose_us', 'activities', 'annual_events',
    'campus_facilities', 'accolades', 'alumni', 'student_achievements',
    'sports_indoor', 'sports_outdoor', 'student_council', 'house_captains'
  ));

commit;


-- =====================================================================
-- Verification — run after the script and eyeball the output.
-- =====================================================================
-- Expect the five new fee_structures columns:
--   select column_name from information_schema.columns
--   where table_name = 'fee_structures'
--     and column_name in ('instalment_no','instalment_name','month_label',
--                         'student_type','late_fee_start_date');
--
-- Expect student_council / house_captains in the constraint:
--   select pg_get_constraintdef(oid) from pg_constraint
--   where conname = 'section_cards_section_check';
--
-- Expect both staff policies:
--   select policyname from pg_policies
--   where policyname in ('students_select_staff','student_enrollments_select_staff');
