-- =====================================================================
-- CONSOLIDATED MIGRATION — ERP + CMS sync with NKPS upstream  (v2, corrected)
-- =====================================================================
-- Run this ONCE, top to bottom, in the Supabase SQL editor for the
-- Murlipura project. Safe to run even if the earlier version was partially
-- applied — every statement is idempotent.
--
-- WHY v2: the Murlipura DB already contains accolades / alumni /
-- student_achievements / sports_* section rows. Upstream's step-wise CMS
-- constraint migrations (059, 061, 064, 065, 067) briefly install a NARROWER
-- section CHECK constraint that those existing rows violate — that is the
-- "section_cards_section_check is violated by some row" error. v2 collapses
-- the section constraint into its final form up front and drops the
-- Rajawas-specific content seeds, so nothing conflicts with Murlipura data.
--
-- WHAT IT DOES
--   * Section constraint: remove retired 'latest_updates' rows, set the final
--     allowed-section set (one shot, no intermediate narrowing)
--   * ERP schema (the code needs this): stop-based transport fleet, telephony
--     call_logs, student profile/UDISE/guardian columns, fee change-request +
--     per-day late fee, staff license/webp, teacher backfills & integrity
--   * CMS row-level-security hardening
--
-- DELIBERATELY EXCLUDED
--   * Rajawas content seeds (accolades/alumni/student-achievements/sports/
--     why-choose-us default rows) — your Murlipura content is kept as-is
--   * Rajawas bus-stop seed data (075, 077) — add Murlipura stops in the
--     Transport UI
--
-- Preserves ALL Murlipura data (holiday_homework, prospectus_documents, your
-- existing section content). The obsolete transport_fare_slabs table is left
-- untouched (orphaned, harmless).
--
-- >>> Run against a backup / staging copy first if you can, then production. <<<
-- =====================================================================


-- ============================================================
-- 0. Section constraint fix (heals a partial earlier run; sets final set)
-- ============================================================
begin;
delete from section_cards where section = 'latest_updates';
alter table section_cards drop constraint if exists section_cards_section_check;
alter table section_cards add constraint section_cards_section_check
  check (section in (
    'hero_slider', 'testimonials', 'facilities_preview', 'leadership',
    'legacy_timeline', 'why_choose_us', 'activities', 'annual_events',
    'campus_facilities', 'accolades', 'alumni', 'student_achievements',
    'sports_indoor', 'sports_outdoor'
  ));
commit;

-- ============================================================
-- migration-072-student-profile-udise.sql
-- ============================================================
-- migration-072-student-profile-udise.sql
--
-- Extends `students` to hold the school's mandated UDISE+-style student
-- template: a General Profile (21 particulars) + Enrolment Profile (12
-- particulars). All student-level template fields become flat columns here
-- (one table); class/section/stream/roll/subjects stay on the enrollment
-- tables. Existing columns are reused where they already match the template:
-- address = Present Address, category = Social Category, nationality derives
-- "Indian National? (YES/NO)", previous_school = previous school name.
--
-- Every column is NULLABLE — bulk uploads arrive partially filled, and for
-- booleans "unknown" must stay distinguishable from "NO".
--
-- Format rules for aadhar/mobiles/pincodes deliberately live in Zod, not in
-- CHECK constraints: real-world sheets are dirty, and one bad value would
-- fail an entire 100-row upsert batch. Enum-ish columns DO get CHECKs since
-- app-side normalization maps unknown values to NULL before insert.
-- Idempotent.

ALTER TABLE students
  -- ── General Profile ───────────────────────────────────────────────────
  ADD COLUMN IF NOT EXISTS name_as_per_aadhar text,
  ADD COLUMN IF NOT EXISTS jan_aadhar_number text,
  ADD COLUMN IF NOT EXISTS mother_occupation text,
  ADD COLUMN IF NOT EXISTS mother_qualification text,
  ADD COLUMN IF NOT EXISTS mother_mobile text,
  ADD COLUMN IF NOT EXISTS mother_annual_income numeric(12, 2),
  ADD COLUMN IF NOT EXISTS father_occupation text,
  ADD COLUMN IF NOT EXISTS father_qualification text,
  ADD COLUMN IF NOT EXISTS father_mobile text,
  ADD COLUMN IF NOT EXISTS father_annual_income numeric(12, 2),
  ADD COLUMN IF NOT EXISTS guardian_name text,
  ADD COLUMN IF NOT EXISTS guardian_relation text,
  ADD COLUMN IF NOT EXISTS guardian_mobile text,
  -- `address` (existing) is the Present Address; pincodes are separate so
  -- the template's "Address + Pin Code" sub-fields round-trip losslessly.
  ADD COLUMN IF NOT EXISTS present_pincode text,
  ADD COLUMN IF NOT EXISTS permanent_address text,
  ADD COLUMN IF NOT EXISTS permanent_pincode text,
  ADD COLUMN IF NOT EXISTS mother_tongue text,
  -- Distinct from `religion`: the template's Minority Group is a fixed
  -- administrative list (incl. 'none'), not free-text religion.
  ADD COLUMN IF NOT EXISTS minority_group text,
  ADD COLUMN IF NOT EXISTS is_bpl boolean,
  ADD COLUMN IF NOT EXISTS is_ews boolean,
  ADD COLUMN IF NOT EXISTS is_cwsn boolean,
  -- Free text "type (code)" — UDISE impairment codes vary by cycle.
  ADD COLUMN IF NOT EXISTS cwsn_impairment_type text,
  ADD COLUMN IF NOT EXISTS height_cm numeric(5, 1),
  ADD COLUMN IF NOT EXISTS weight_kg numeric(5, 1),
  -- ── Enrolment Profile ─────────────────────────────────────────────────
  ADD COLUMN IF NOT EXISTS is_rte boolean,
  ADD COLUMN IF NOT EXISTS medium_of_instruction text,
  ADD COLUMN IF NOT EXISTS previous_school_address text,
  ADD COLUMN IF NOT EXISTS previous_school_block text,
  ADD COLUMN IF NOT EXISTS previous_school_district text,
  ADD COLUMN IF NOT EXISTS previous_school_state text,
  ADD COLUMN IF NOT EXISTS previous_school_udise_code text,
  ADD COLUMN IF NOT EXISTS previous_school_reason_for_leaving text,
  ADD COLUMN IF NOT EXISTS previous_class_studied text,
  ADD COLUMN IF NOT EXISTS previous_school_board text,
  -- Text, not numeric: board roll numbers can be alphanumeric.
  ADD COLUMN IF NOT EXISTS board_roll_number text,
  ADD COLUMN IF NOT EXISTS board_percentage numeric(5, 2),
  -- Text: schools record this as "92%" or "180/210 days".
  ADD COLUMN IF NOT EXISTS last_session_attendance text,
  ADD COLUMN IF NOT EXISTS is_staff_ward boolean,
  ADD COLUMN IF NOT EXISTS participates_ncc boolean,
  ADD COLUMN IF NOT EXISTS participates_nss boolean,
  ADD COLUMN IF NOT EXISTS participates_scouts boolean,
  ADD COLUMN IF NOT EXISTS participates_competitions boolean,
  ADD COLUMN IF NOT EXISTS distance_band text,
  -- Template item 12 is ONE dropdown covering mother/father/legal guardian —
  -- "completed highest education level" of whichever parent it applies to.
  ADD COLUMN IF NOT EXISTS parent_highest_education text;

ALTER TABLE students DROP CONSTRAINT IF EXISTS chk_students_minority_group;
ALTER TABLE students ADD CONSTRAINT chk_students_minority_group CHECK (
  minority_group IS NULL
  OR minority_group IN ('muslim', 'sikh', 'christian', 'jain', 'buddhist', 'parsi', 'none')
);

ALTER TABLE students DROP CONSTRAINT IF EXISTS chk_students_medium;
ALTER TABLE students ADD CONSTRAINT chk_students_medium CHECK (
  medium_of_instruction IS NULL
  OR medium_of_instruction IN ('english', 'hindi')
);

ALTER TABLE students DROP CONSTRAINT IF EXISTS chk_students_distance_band;
ALTER TABLE students ADD CONSTRAINT chk_students_distance_band CHECK (
  distance_band IS NULL
  OR distance_band IN ('1-3km', '3-5km', '5-10km', 'above-10km')
);

ALTER TABLE students DROP CONSTRAINT IF EXISTS chk_students_parent_highest_education;
ALTER TABLE students ADD CONSTRAINT chk_students_parent_highest_education CHECK (
  parent_highest_education IS NULL
  OR parent_highest_education IN (
    'primary', 'upper_primary', 'secondary', 'senior_secondary',
    'graduation', 'pg_or_more'
  )
);

ALTER TABLE students DROP CONSTRAINT IF EXISTS chk_students_height_cm;
ALTER TABLE students ADD CONSTRAINT chk_students_height_cm CHECK (
  height_cm IS NULL OR (height_cm > 0 AND height_cm < 300)
);

ALTER TABLE students DROP CONSTRAINT IF EXISTS chk_students_weight_kg;
ALTER TABLE students ADD CONSTRAINT chk_students_weight_kg CHECK (
  weight_kg IS NULL OR (weight_kg > 0 AND weight_kg < 500)
);

ALTER TABLE students DROP CONSTRAINT IF EXISTS chk_students_board_percentage;
ALTER TABLE students ADD CONSTRAINT chk_students_board_percentage CHECK (
  board_percentage IS NULL OR (board_percentage >= 0 AND board_percentage <= 100)
);


-- ============================================================
-- migration-073-telephony-call-logs.sql
-- ============================================================
-- migration-073-telephony-call-logs.sql
--
-- Click-to-call: teachers/admins ring a student's parent/guardian from the ERP
-- through Exotel, which bridges the two legs so neither party sees the other's
-- real number (both see the school's ExoPhone). This table is the audit trail
-- for every such call.
--
-- PII stance: we deliberately DO NOT store the numbers dialled — only
-- `contact_type` (which relation was called) plus the student/actor FKs. The
-- resolvable numbers already live on `students` / `profiles`; duplicating them
-- here would spread PII with no benefit. Exotel's own call SID + status close
-- the loop for support/billing questions.
--
-- The agent leg (the staff member's own phone Exotel rings first) is read from
-- profiles.phone at call time — no new column needed.
--
-- RLS follows the fees-module convention: enabled with an admin-only policy;
-- the real gate is the service-role API layer (verifyAdminOrEditorWithUser),
-- where editors granted the `students` feature are allowed. Idempotent.

CREATE TABLE IF NOT EXISTS call_logs (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  -- Who placed the call. RESTRICT: an audit row must never be orphaned by a
  -- profile delete; reassign/close out staff before removing them.
  actor_id uuid NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
  -- SET NULL so call history survives a student record being deleted.
  student_id uuid REFERENCES students(id) ON DELETE SET NULL,
  -- Which number on the student was dialled. No raw number is stored.
  contact_type text NOT NULL
    CHECK (contact_type IN ('student', 'father', 'mother', 'guardian')),
  -- Exotel's Call Sid, populated once the connect API responds. Null while a
  -- call is still 'initiated' or if dispatch failed before Exotel accepted it.
  exotel_sid text,
  -- Lifecycle: 'initiated' (row written, pre-dispatch) → Exotel's own statuses
  -- via the connect response and the status-callback webhook. 'error' is our
  -- terminal state when the dispatch itself threw.
  status text NOT NULL DEFAULT 'initiated'
    CHECK (status IN (
      'initiated', 'error', 'queued', 'in-progress',
      'completed', 'failed', 'busy', 'no-answer', 'canceled'
    )),
  duration_seconds integer,
  recording_url text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Serves both per-actor rate limiting (count recent rows) and an actor's own
-- call history.
CREATE INDEX IF NOT EXISTS idx_call_logs_actor
  ON call_logs (actor_id, created_at DESC);

-- Per-student call history in the detail view.
CREATE INDEX IF NOT EXISTS idx_call_logs_student
  ON call_logs (student_id, created_at DESC);

-- The status-callback webhook looks a row up by Exotel's Sid.
CREATE INDEX IF NOT EXISTS idx_call_logs_exotel_sid
  ON call_logs (exotel_sid)
  WHERE exotel_sid IS NOT NULL;


-- ── RLS ─────────────────────────────────────────────────────────────────────
-- Service-role API layer is the real gate. RLS here only matters for the
-- (unlikely) case where the anon/authed key reaches this table.

ALTER TABLE call_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins have full access to call_logs" ON call_logs;
CREATE POLICY "Admins have full access to call_logs"
  ON call_logs FOR ALL
  USING (public.get_user_role() = 'admin');


-- ============================================================
-- migration-074-transport-stops-fleet.sql
-- ============================================================
-- Migration 074: Stop-based transport — fleet, routes, drivers, change workflow.
--
-- The school prices transport by BUS STOP, not by distance: every student who
-- boards at a given stop pays that stop's flat monthly fee (fairness). This
-- migration REPLACES the distance/slab model (migrations 050/053/055/063) with:
--
--   * bus_stops            — stable stop registry (name = identity)
--   * bus_stop_fees        — per-academic-year flat amount for a stop
--   * buses                — vehicle registry (Bus No. + driver + capacity)
--   * bus_route_stops      — which stops each bus serves (route)
--   * transport_change_requests — bus-change / stop-change / one-side / drop
--                            workflow, submittable by office AND parents
--
-- student_enrollments gains bus_stop_id (drives the fee), bus_id,
-- transport_direction (one-side facility) and transport_fee_override
-- (custom one-side amount). fee_payments swaps transport_slab_id → bus_stop_id.
--
-- Per the "replace and drop" decision, the old slab table, its triggers/RPC,
-- and all distance/pickup-verify columns are DROPPED. This migration is
-- destructive on those objects and idempotent on the new ones.

begin;

-- ═════════════════════════════════════════════════════════════════════
-- PART A — tear down the distance/slab model (050/053/055/063)
-- ═════════════════════════════════════════════════════════════════════

-- A1. Slab cascade triggers + helper fns (055)
drop trigger if exists slab_before_delete_clear_enrollments on transport_fare_slabs;
drop trigger if exists slab_after_deactivate_clear_enrollments on transport_fare_slabs;
drop function if exists trg_clear_transport_on_slab_change();
drop function if exists count_transport_slab_dependents(uuid);

-- A2. fee_payments: drop the slab XOR + column (re-added against stops in PART C)
alter table fee_payments drop constraint if exists fee_payments_target_xor;
drop index if exists idx_fee_payments_transport_slab_id;
alter table fee_payments drop column if exists transport_slab_id;

-- A3. student_enrollments: drop slab/distance/pickup-verify constraints, indexes, columns.
--     KEEP has_transport and pickup_address (repurposed as a free-text landmark).
alter table student_enrollments
  drop constraint if exists student_enrollments_transport_slab_required,
  drop constraint if exists chk_pickup_coords_paired,
  drop constraint if exists chk_pickup_verified_coords_paired,
  drop constraint if exists chk_override_reason_required,
  drop constraint if exists chk_distance_source,
  drop constraint if exists chk_road_distance_floor;

drop index if exists idx_enrollments_transport_slab_id;
drop index if exists idx_enrollments_pickup_unverified;
drop index if exists idx_enrollments_slab_overridden;

alter table student_enrollments
  drop column if exists transport_slab_id,
  drop column if exists transport_slab_suggested_id,
  drop column if exists transport_slab_overridden_at,
  drop column if exists transport_slab_overridden_by,
  drop column if exists transport_slab_override_reason,
  drop column if exists road_distance_km,
  drop column if exists straight_line_km,
  drop column if exists distance_source,
  drop column if exists distance_computed_at,
  drop column if exists distance_computed_by,
  drop column if exists pickup_place_id,
  drop column if exists pickup_route_polyline,
  drop column if exists pickup_lat,
  drop column if exists pickup_lng,
  drop column if exists pickup_verified_at,
  drop column if exists pickup_verified_by,
  drop column if exists pickup_verified_lat,
  drop column if exists pickup_verified_lng;

-- A4. The slab master itself (no FK references remain after A2/A3).
drop table if exists transport_fare_slabs cascade;

-- ═════════════════════════════════════════════════════════════════════
-- PART B — new fleet / stop / route tables
-- ═════════════════════════════════════════════════════════════════════

-- B1. bus_stops — stable stop registry. Name is the identity so fees can be
--     re-priced yearly (via bus_stop_fees) without re-entering stops.
create table if not exists bus_stops (
  id          uuid default gen_random_uuid() primary key,
  name        text not null unique,
  area        text,
  lat         numeric(10,7),
  lng         numeric(10,7),
  is_active   boolean not null default true,
  sort_order  integer not null default 0,
  created_at  timestamptz default now(),
  updated_at  timestamptz default now()
);
create index if not exists idx_bus_stops_active on bus_stops(is_active) where is_active;

-- B2. bus_stop_fees — per-academic-year flat amount for a stop (the "diesel
--     price may raise fare" note ⇒ price is year-scoped, stop is not).
create table if not exists bus_stop_fees (
  id                uuid default gen_random_uuid() primary key,
  bus_stop_id       uuid not null references bus_stops(id) on delete cascade,
  academic_year_id  uuid not null references academic_years(id) on delete cascade,
  amount            numeric(10,2) not null check (amount > 0),
  frequency         text not null default 'monthly'
                    check (frequency in ('monthly','quarterly','annual','one_time')),
  is_active         boolean not null default true,
  created_at        timestamptz default now(),
  updated_at        timestamptz default now(),
  unique (bus_stop_id, academic_year_id)
);
create index if not exists idx_bus_stop_fees_year on bus_stop_fees(academic_year_id);
create index if not exists idx_bus_stop_fees_stop on bus_stop_fees(bus_stop_id);

-- B3. buses — vehicle registry (source of the "Bus No." dropdown). Driver is a
--     staff_members row with category='busDriver' (enforced app-side).
create table if not exists buses (
  id                  uuid default gen_random_uuid() primary key,
  bus_number          text not null unique,
  registration_number text,
  capacity            integer check (capacity is null or capacity > 0),
  driver_id           uuid references staff_members(id) on delete set null,
  conductor_id        uuid references staff_members(id) on delete set null,
  is_active           boolean not null default true,
  notes               text,
  created_at          timestamptz default now(),
  updated_at          timestamptz default now()
);
create index if not exists idx_buses_active on buses(is_active) where is_active;
create index if not exists idx_buses_driver on buses(driver_id) where driver_id is not null;

-- B4. bus_route_stops — which stops each bus serves (route). Assigning a
--     student a stop narrows the bus picker to buses that serve it.
create table if not exists bus_route_stops (
  id           uuid default gen_random_uuid() primary key,
  bus_id       uuid not null references buses(id) on delete cascade,
  bus_stop_id  uuid not null references bus_stops(id) on delete cascade,
  sort_order   integer,
  created_at   timestamptz default now(),
  unique (bus_id, bus_stop_id)
);
create index if not exists idx_bus_route_stops_bus on bus_route_stops(bus_id);
create index if not exists idx_bus_route_stops_stop on bus_route_stops(bus_stop_id);

-- ═════════════════════════════════════════════════════════════════════
-- PART C — student_enrollments + fee_payments stop columns
-- ═════════════════════════════════════════════════════════════════════

-- C1. Enrollment: stop drives the fee; bus is the assigned vehicle; direction
--     is the one-side facility (school-only) with a required custom amount.
alter table student_enrollments
  add column if not exists bus_stop_id uuid references bus_stops(id) on delete set null,
  add column if not exists bus_id uuid references buses(id) on delete set null,
  add column if not exists transport_direction text not null default 'both',
  add column if not exists transport_fee_override numeric(10,2);

alter table student_enrollments
  drop constraint if exists chk_transport_direction;
alter table student_enrollments
  add constraint chk_transport_direction
  check (transport_direction in ('both','pickup_only','drop_only'));

-- Legacy opt-ins had a slab, not a stop — there is no slab→stop mapping, so
-- opt them out here. The office re-assigns each to a stop via the new
-- Transport → Student Assignments page. (Mirrors migration 050's orphan reset.)
do $$
declare n int;
begin
  select count(*) into n from student_enrollments
    where has_transport = true and bus_stop_id is null;
  if n > 0 then
    update student_enrollments
      set has_transport = false
      where has_transport = true and bus_stop_id is null;
    raise notice 'migration 074: opted % enrollment(s) out of transport (no stop yet). Re-assign them on Transport → Student Assignments.', n;
  end if;
end $$;

-- has_transport ⟹ a stop is assigned (the stop is the fee basis).
alter table student_enrollments
  drop constraint if exists student_enrollments_bus_stop_required;
alter table student_enrollments
  add constraint student_enrollments_bus_stop_required
  check (has_transport = false or bus_stop_id is not null);

-- One-side facility always carries a custom amount (there is no half-fee rule).
alter table student_enrollments
  drop constraint if exists chk_one_side_fee_override;
alter table student_enrollments
  add constraint chk_one_side_fee_override
  check (transport_direction = 'both' or transport_fee_override is not null);

create index if not exists idx_enrollments_bus_stop_id
  on student_enrollments(bus_stop_id) where bus_stop_id is not null;
create index if not exists idx_enrollments_bus_id
  on student_enrollments(bus_id) where bus_id is not null;

-- C2. fee_payments: a transport receipt now targets a bus_stop.
alter table fee_payments
  add column if not exists bus_stop_id uuid references bus_stops(id);

create index if not exists idx_fee_payments_bus_stop_id
  on fee_payments(bus_stop_id) where bus_stop_id is not null;

-- Exactly one of (fee_structure_id, bus_stop_id) identifies what was paid.
-- NOT VALID so legacy transport receipts (they pointed at a now-dropped slab
-- and can't be re-mapped to a stop) survive as history without blocking the
-- migration; the rule is still enforced on every new insert/update.
alter table fee_payments
  add constraint fee_payments_target_xor
  check (
    (fee_structure_id is not null and bus_stop_id is null)
    or (fee_structure_id is null and bus_stop_id is not null)
  ) not valid;

-- ═════════════════════════════════════════════════════════════════════
-- PART D — transport_change_requests (the amendment workflow)
-- ═════════════════════════════════════════════════════════════════════
create table if not exists transport_change_requests (
  id              uuid default gen_random_uuid() primary key,
  enrollment_id   uuid not null references student_enrollments(id) on delete cascade,
  change_type     text not null
                  check (change_type in ('bus_change','stop_change','direction_change','drop','resume')),
  previous_bus_id  uuid references buses(id) on delete set null,
  amended_bus_id   uuid references buses(id) on delete set null,
  previous_stop_id uuid references bus_stops(id) on delete set null,
  amended_stop_id  uuid references bus_stops(id) on delete set null,
  direction       text check (direction is null or direction in ('both','pickup_only','drop_only')),
  effective_from  date not null,
  effective_to    date,
  reason_code     text not null
                  check (reason_code in (
                    'house_shifting','rented_house_change','bus_point_temporary_change',
                    'facility_dropped','one_side_facility','other')),
  reason_note     text,
  application_url text,
  source          text not null check (source in ('office','parent')),
  status          text not null default 'pending'
                  check (status in ('pending','approved','rejected','cancelled','applied')),
  requested_by    uuid references profiles(id) on delete set null,
  reviewed_by     uuid references profiles(id) on delete set null,
  reviewed_at     timestamptz,
  review_note     text,
  created_at      timestamptz default now(),
  updated_at      timestamptz default now(),
  -- A temporary window can't end before it starts.
  constraint chk_tcr_window check (effective_to is null or effective_to >= effective_from),
  -- 'other' must explain itself.
  constraint chk_tcr_reason_note check (
    reason_code <> 'other'
    or (reason_note is not null and length(btrim(reason_note)) >= 3)
  ),
  -- One-side (direction change) is a school-only action.
  constraint chk_tcr_direction_office check (change_type <> 'direction_change' or source = 'office')
);
create index if not exists idx_tcr_enrollment on transport_change_requests(enrollment_id);
create index if not exists idx_tcr_pending on transport_change_requests(status) where status = 'pending';

-- ═════════════════════════════════════════════════════════════════════
-- PART E — updated_at triggers
-- ═════════════════════════════════════════════════════════════════════
drop trigger if exists set_updated_at_bus_stops on bus_stops;
create trigger set_updated_at_bus_stops before update on bus_stops
  for each row execute function public.set_updated_at();
drop trigger if exists set_updated_at_bus_stop_fees on bus_stop_fees;
create trigger set_updated_at_bus_stop_fees before update on bus_stop_fees
  for each row execute function public.set_updated_at();
drop trigger if exists set_updated_at_buses on buses;
create trigger set_updated_at_buses before update on buses
  for each row execute function public.set_updated_at();
drop trigger if exists set_updated_at_transport_change_requests on transport_change_requests;
create trigger set_updated_at_transport_change_requests before update on transport_change_requests
  for each row execute function public.set_updated_at();

-- ═════════════════════════════════════════════════════════════════════
-- PART F — RLS
--   Fleet/stop tables: public read (parents/students see stop, fee, bus,
--   driver via the anon client), admin write.
--   Change requests: admin full; parents/students read only their own child's
--   rows (writes go through a service-role server route).
-- ═════════════════════════════════════════════════════════════════════
alter table bus_stops enable row level security;
alter table bus_stop_fees enable row level security;
alter table buses enable row level security;
alter table bus_route_stops enable row level security;
alter table transport_change_requests enable row level security;

do $$
declare
  t text;
begin
  foreach t in array array['bus_stops','bus_stop_fees','buses','bus_route_stops'] loop
    execute format('drop policy if exists "Public can read %1$s" on %1$s', t);
    execute format('create policy "Public can read %1$s" on %1$s for select using (true)', t);
    execute format('drop policy if exists "Admins write %1$s" on %1$s', t);
    execute format($p$create policy "Admins write %1$s" on %1$s for all
      using (public.get_user_role() = 'admin')
      with check (public.get_user_role() = 'admin')$p$, t);
  end loop;
end $$;

drop policy if exists "Admins full access transport changes" on transport_change_requests;
create policy "Admins full access transport changes"
  on transport_change_requests for all
  using (public.get_user_role() = 'admin')
  with check (public.get_user_role() = 'admin');

drop policy if exists "Parents read own child transport changes" on transport_change_requests;
create policy "Parents read own child transport changes"
  on transport_change_requests for select
  using (
    enrollment_id in (
      select se.id from student_enrollments se
      where se.student_id in (select public.get_my_children_ids())
    )
  );

drop policy if exists "Students read own transport changes" on transport_change_requests;
create policy "Students read own transport changes"
  on transport_change_requests for select
  using (
    enrollment_id in (
      select se.id from student_enrollments se
      where se.student_id = public.get_my_student_id()
    )
  );

commit;


-- ============================================================
-- migration-076-transport-applications-bucket.sql
-- ============================================================
-- Migration 076: private storage bucket for transport change-request applications.
--
-- Parents (parent portal) and the school office upload a scanned application
-- (PDF/JPG/PNG) supporting a bus-change / stop-change / drop request. The file
-- is written server-side via the service-role client; the admin changes page
-- reads it through a short-lived signed URL. Private bucket — never public.
-- Idempotent.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'transport-applications',
  'transport-applications',
  false,
  10485760, -- 10 MB
  array['application/pdf','image/jpeg','image/png']
)
on conflict (id) do update
  set file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Only the service role writes/reads objects here (routes use the admin client
-- and mint signed URLs). No public read policy — the bucket stays private.
drop policy if exists "Service role manages transport applications" on storage.objects;
create policy "Service role manages transport applications"
  on storage.objects for all
  to service_role
  using (bucket_id = 'transport-applications')
  with check (bucket_id = 'transport-applications');


-- ============================================================
-- migration-063-transport-road-distance.sql
-- ============================================================
-- migration-063-transport-road-distance.sql
--
-- Moves transport fee slabbing from straight-line (haversine) distance to the
-- real ROAD (driving) distance from school to the student's confirmed pickup
-- point. A 5 km radius circle is not 5 km of road, so the radial model over/
-- under-charged families with the same as-the-crow-flies distance.
--
-- The road distance is computed in the browser via the Google Maps
-- DirectionsService (the only key available is referrer-restricted) and then
-- re-validated server-side against the straight-line floor before billing.
-- These columns capture the billed number plus full provenance so every fare
-- is explainable and reproducible.
--
-- Reuses the existing pickup_lat/lng + override/verify audit columns from
-- migration-053. Idempotent.

ALTER TABLE student_enrollments
  -- The billed one-way road distance (km) from school to the pickup point.
  ADD COLUMN IF NOT EXISTS road_distance_km numeric(6, 2),
  -- Server-computed haversine for the same coords. Kept as the audit FLOOR
  -- (real road distance is always >= straight line) and for sanity checks.
  ADD COLUMN IF NOT EXISTS straight_line_km numeric(6, 2),
  -- How the billed distance was obtained: 'google_routes' = DirectionsService,
  -- 'manual' = admin assigned a slab by hand (Google failed / no coords).
  ADD COLUMN IF NOT EXISTS distance_source text,
  ADD COLUMN IF NOT EXISTS distance_computed_at timestamptz,
  ADD COLUMN IF NOT EXISTS distance_computed_by uuid
    REFERENCES profiles(id) ON DELETE SET NULL,
  -- Google place id of the confirmed pickup — reproducibility + sibling dedup.
  ADD COLUMN IF NOT EXISTS pickup_place_id text,
  -- Encoded overview polyline of the route, so it can be redrawn on the map
  -- and audited later without another billable Directions call.
  ADD COLUMN IF NOT EXISTS pickup_route_polyline text;

-- Constrain the provenance value (nullable: cleared on opt-out).
ALTER TABLE student_enrollments
  DROP CONSTRAINT IF EXISTS chk_distance_source;
ALTER TABLE student_enrollments
  ADD CONSTRAINT chk_distance_source CHECK (
    distance_source IS NULL
    OR distance_source IN ('google_routes', 'manual')
  );

-- A road-distance-sourced fare must have the road distance >= the straight
-- line for the same coords (a road can't be shorter than the crow-flies line).
-- Enforced only when both numbers are present and the source is google_routes,
-- so existing rows and manual assignments aren't blocked.
ALTER TABLE student_enrollments
  DROP CONSTRAINT IF EXISTS chk_road_distance_floor;
ALTER TABLE student_enrollments
  ADD CONSTRAINT chk_road_distance_floor CHECK (
    distance_source IS DISTINCT FROM 'google_routes'
    OR road_distance_km IS NULL
    OR straight_line_km IS NULL
    -- 0.1 km slack absorbs rounding at very short distances.
    OR road_distance_km >= straight_line_km - 0.1
  );

COMMENT ON COLUMN student_enrollments.road_distance_km IS
  'Billed one-way road (driving) distance in km from school to the pickup point. Replaces haversine as the slabbing input.';
COMMENT ON COLUMN student_enrollments.straight_line_km IS
  'Server-computed haversine for the pickup coords. Audit floor for road_distance_km; never billed directly.';
COMMENT ON COLUMN student_enrollments.distance_source IS
  'google_routes = DirectionsService road distance; manual = admin-assigned slab (Google failed/no coords, reason required).';
COMMENT ON COLUMN student_enrollments.pickup_place_id IS
  'Google place id of the confirmed pickup point, for reproducibility and sibling dedup.';
COMMENT ON COLUMN student_enrollments.pickup_route_polyline IS
  'Encoded overview polyline of the school->pickup route, for map redraw and audit without re-billing Directions.';


-- ============================================================
-- migration-078-staff-license-number.sql
-- ============================================================
-- migration-078-staff-license-number.sql
--
-- Adds a driving-license number to staff records, for the school's transport
-- roster. Only bus drivers (category = 'busDriver') use it in the UI, but the
-- column lives on staff_members like every other staff particular rather than
-- on a driver-specific side table — a driver IS a staff member, and a flat
-- nullable column keeps the existing /api/staff read/write path unchanged.
--
-- NULLABLE: existing rows have no license on file, and non-driver staff never
-- get one. No format CHECK — license formats vary by state/RTO and dirty data
-- must not block a staff update (format validation lives in Zod).
-- Idempotent.

ALTER TABLE staff_members
  ADD COLUMN IF NOT EXISTS license_number text;


-- ============================================================
-- migration-079-staff-photos-allow-webp.sql
-- ============================================================
-- Migration 079 — allow WebP in the staff-photos storage bucket.
--
-- The browser upload pipeline (packages/shared/src/lib/image-compress.ts, run
-- from uploadToStorage) downscales and re-encodes raster images to WebP before
-- upload. The staff-photos bucket's MIME allowlist (set in migration 061) only
-- permitted image/jpeg and image/png, so every cropped staff photo — which
-- arrives as image/webp — was rejected at the storage layer with
-- "mime type image/webp is not supported".
--
-- Bring staff-photos in line with the other public image buckets
-- (gallery / site-media / avatars already allow webp). Size cap unchanged.
-- Idempotent: re-running just re-sets the same array.

UPDATE storage.buckets
  SET allowed_mime_types = ARRAY['image/jpeg','image/png','image/webp']
  WHERE id = 'staff-photos';


-- ============================================================
-- migration-080-fee-late-fee-per-day.sql
-- ============================================================
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


-- ============================================================
-- migration-070-fee-change-request-insert.sql
-- ============================================================
-- =============================================================
-- Migration 070: fee_change_requests — support INSERT actions
-- =============================================================
-- Editors are blocked from clearing dues directly (waivers) the same way
-- they're blocked from direct refunds: they must file a change request for an
-- admin to approve. A waiver is a brand-new fee_payments row, so the change
-- request system — until now update/delete-only on an existing target row —
-- needs to model an INSERT (no target_id, no prior snapshot).
--
-- SAFE TO RE-RUN: drops/recreates named constraints; ALTER ... DROP NOT NULL
-- is idempotent.
-- =============================================================

BEGIN;

-- fee_change_requests: an INSERT request has no target row to point at or
-- snapshot, so both become nullable and a table-level CHECK keeps the two
-- shapes (insert vs update/delete) consistent.
ALTER TABLE fee_change_requests ALTER COLUMN target_id DROP NOT NULL;
ALTER TABLE fee_change_requests ALTER COLUMN current_snapshot DROP NOT NULL;

ALTER TABLE fee_change_requests
  DROP CONSTRAINT IF EXISTS fee_change_requests_action_check;
ALTER TABLE fee_change_requests
  ADD CONSTRAINT fee_change_requests_action_check
  CHECK (action IN ('insert', 'update', 'delete'));

ALTER TABLE fee_change_requests
  DROP CONSTRAINT IF EXISTS chk_change_request_target;
ALTER TABLE fee_change_requests
  ADD CONSTRAINT chk_change_request_target CHECK (
    (action = 'insert'
      AND target_id IS NULL
      AND current_snapshot IS NULL)
    OR (action IN ('update', 'delete')
      AND target_id IS NOT NULL
      AND current_snapshot IS NOT NULL)
  );

-- fee_change_audit_log: an applied INSERT has no before_snapshot and no
-- pre-existing target_id (the row is created during apply; its new id is
-- captured in after_snapshot).
ALTER TABLE fee_change_audit_log ALTER COLUMN target_id DROP NOT NULL;
ALTER TABLE fee_change_audit_log ALTER COLUMN before_snapshot DROP NOT NULL;

ALTER TABLE fee_change_audit_log
  DROP CONSTRAINT IF EXISTS fee_change_audit_log_action_check;
ALTER TABLE fee_change_audit_log
  ADD CONSTRAINT fee_change_audit_log_action_check
  CHECK (action IN ('insert', 'update', 'delete'));

COMMIT;


-- ============================================================
-- migration-061-profile-and-storage-hardening.sql
-- ============================================================
-- Migration 061: Profile privilege-escalation + signup + storage hardening
--
-- Three independent security fixes from the May-2026 security audit. All are
-- safe to apply on a live DB and do not change the admin/editor experience
-- (those paths use the service-role client, which bypasses RLS and is
-- explicitly allowed by the guards below).
--
-- ── C1 (Critical): profiles self-update could escalate to admin ──────────────
--   The "Users can update own profile" policy had only a USING clause (no
--   WITH CHECK, no column restriction), so any authenticated parent/student
--   could `UPDATE profiles SET role='admin'` on their own row via the browser
--   anon client and instantly own the platform. We add a BEFORE UPDATE trigger
--   that rejects changes to privileged columns (role, is_active,
--   must_change_password, teacher_id, student_id, parent_id) unless the caller
--   is an admin or the service role. We also REVOKE blanket column UPDATE and
--   GRANT back only the columns a user may legitimately self-edit.
--
-- ── H1 (High): handle_new_user trusted a client-asserted role ────────────────
--   The signup trigger copied `raw_user_meta_data->>'role'` verbatim. If public
--   signup is ever enabled in Supabase Auth, an attacker could self-register as
--   admin. We hardcode 'student' on insert; the admin creation paths
--   (auth.admin.createUser → registrations/approve, /api/users, bulk-create)
--   set the real role server-side afterward via the service-role client.
--
-- ── H2 (High): storage buckets ──────────────────────────────────────────────
--   The transfer-certificates bucket is flipped to private MANUALLY in Supabase
--   Studio (deliberate operational choice); the signed-URL TC routes work either
--   way, so this migration does not automate that flip.
--   Writes to content buckets are restricted to the service role (all uploads
--   already go through admin-gated signed-URL minting or the avatar API, which
--   use the service-role client; signed-URL uploads are authorized by the token,
--   not by the uploader's RLS, so this does not break them).
--
--   NOTE: the previous bucket policies were created in the Supabase Dashboard
--   ("Allow authenticated users") and are NOT in this file, so they cannot be
--   dropped by name here. After running this migration you MUST delete the old
--   permissive INSERT/UPDATE/DELETE policies on storage.objects for the buckets
--   gallery, transfer-certificates, site-media, staff-photos, avatars,
--   disclosure-documents in Dashboard → Storage → Policies. Otherwise RLS stays
--   permissive (policies are OR-combined).

-- ============================================================
-- C1 — Lock privileged profile columns
-- ============================================================
CREATE OR REPLACE FUNCTION public.guard_profile_privileged_cols()
RETURNS TRIGGER AS $$
BEGIN
  -- Server-side API (service-role client) and admins may change anything.
  IF auth.role() = 'service_role' OR public.get_user_role() = 'admin' THEN
    RETURN NEW;
  END IF;

  -- A regular authenticated user (parent/student/teacher/staff editing their
  -- own row) must not touch role/access columns.
  IF NEW.role               IS DISTINCT FROM OLD.role
     OR NEW.is_active             IS DISTINCT FROM OLD.is_active
     OR NEW.must_change_password  IS DISTINCT FROM OLD.must_change_password
     OR NEW.teacher_id            IS DISTINCT FROM OLD.teacher_id
     OR NEW.student_id            IS DISTINCT FROM OLD.student_id
     OR NEW.parent_id             IS DISTINCT FROM OLD.parent_id THEN
    RAISE EXCEPTION 'Not allowed to modify privileged profile columns';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS guard_profile_privileged_cols ON profiles;
CREATE TRIGGER guard_profile_privileged_cols
  BEFORE UPDATE ON profiles
  FOR EACH ROW EXECUTE FUNCTION public.guard_profile_privileged_cols();

-- Defense in depth: column-level privileges. Even if the trigger were dropped,
-- the authenticated role cannot write privileged columns. Service role and
-- admin write via the service-role key, which is not subject to these grants.
REVOKE UPDATE ON public.profiles FROM authenticated;
GRANT UPDATE (full_name, phone, avatar_url) ON public.profiles TO authenticated;

-- ============================================================
-- H1 — Do not trust client-supplied role at signup
-- ============================================================
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name, role)
  VALUES (
    new.id, new.email,
    COALESCE(new.raw_user_meta_data->>'full_name', new.email),
    -- Role is NEVER taken from client metadata. Admin-creation paths set the
    -- real role afterward via the service-role client.
    'student'
  );
  RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- H2 — Storage: private TC bucket + service-role-only writes
-- ============================================================
-- NOTE: the transfer-certificates bucket is flipped to private MANUALLY in
-- Supabase Studio (deliberate operational choice — see project memory). The TC
-- lookup/download routes issue short-lived signed URLs that work regardless of
-- the bucket's public flag, so this migration intentionally does NOT automate it.

-- Restrict writes on user-content buckets to the service role. Signed-URL
-- uploads (gallery/site-media/staff-photos/disclosure) and the avatar API all
-- run through the service-role client, so this does not affect them.
DROP POLICY IF EXISTS "Service role manages content buckets" ON storage.objects;
CREATE POLICY "Service role manages content buckets"
  ON storage.objects FOR ALL
  TO service_role
  USING (
    bucket_id IN ('gallery','transfer-certificates','site-media',
                  'staff-photos','disclosure-documents','avatars')
  )
  WITH CHECK (
    bucket_id IN ('gallery','transfer-certificates','site-media',
                  'staff-photos','disclosure-documents','avatars')
  );

-- A user may overwrite ONLY their own avatar object (avatars/<uid>.<ext>),
-- matching apps/erp/.../api/portal/avatar/route.ts which writes that path via
-- the service-role client. This policy lets a future direct-anon-client avatar
-- upload remain self-scoped without granting cross-user write.
DROP POLICY IF EXISTS "Users manage own avatar object" ON storage.objects;
CREATE POLICY "Users manage own avatar object"
  ON storage.objects FOR ALL
  TO authenticated
  USING (
    bucket_id = 'avatars'
    AND (storage.foldername(name))[1] IS NOT DISTINCT FROM auth.uid()::text
  )
  WITH CHECK (
    bucket_id = 'avatars'
    AND (storage.foldername(name))[1] IS NOT DISTINCT FROM auth.uid()::text
  );

-- Public read for public buckets (everything except transfer-certificates).
DROP POLICY IF EXISTS "Public read of public content buckets" ON storage.objects;
CREATE POLICY "Public read of public content buckets"
  ON storage.objects FOR SELECT
  USING (
    bucket_id IN ('gallery','site-media','staff-photos','avatars',
                  'disclosure-documents')
  );

-- Enforce allowed MIME types + size caps at the STORAGE layer. The signed-URL
-- upload flow lets the client set the object's content-type, so an attacker
-- could otherwise store HTML/SVG under an image/pdf extension and get stored
-- XSS. allowed_mime_types makes Supabase reject the upload regardless of the
-- client. (Closes the content-type-spoofing + SVG class; bounds quota abuse.)
UPDATE storage.buckets
  SET allowed_mime_types = ARRAY['image/jpeg','image/png','image/webp'],
      file_size_limit = 5242880      -- 5 MB
  WHERE id IN ('gallery','site-media','avatars');
UPDATE storage.buckets
  SET allowed_mime_types = ARRAY['image/jpeg','image/png'],
      file_size_limit = 2097152      -- 2 MB
  WHERE id = 'staff-photos';
UPDATE storage.buckets
  SET allowed_mime_types = ARRAY['application/pdf'],
      file_size_limit = 10485760     -- 10 MB
  WHERE id IN ('transfer-certificates','disclosure-documents');


-- ============================================================
-- migration-062-backfill-teacher-profile-link.sql
-- ============================================================
-- Migration 062 — backfill profiles.teacher_id for teacher accounts that were
-- linked to the wrong id by the staff "Create Users" (bulk-create) flow.
--
-- Bug: /api/portal/bulk-create wrote `profiles.teacher_id = staff_members.id`,
-- but the column is a FK to `teachers.id`. The mismatched write violated the FK
-- and silently failed, leaving teacher_id NULL. Affected teachers could not see
-- their assigned classes/students or mark attendance because every teacher-facing
-- query resolves the user via `SELECT teacher_id FROM profiles WHERE id = auth.uid()`.
--
-- The code path is fixed going forward (it now resolves the real teachers.id via
-- promoteStaffToTeacher). This repairs accounts already created. There is no stored
-- staff_member_id on the profile to recover from, so we re-link by email — the
-- teachers row mirrors the staff member's email, which equals the login email.
--
-- profiles.teacher_id is a privileged column locked by the guard_profile_privileged_cols
-- trigger (migration 061). That guard only exempts the service-role client and admins
-- resolved via a JWT (auth.uid()). Run from the Supabase SQL editor — the postgres
-- superuser with NO JWT — neither exemption matches, so the trigger blocks this
-- backfill with "Not allowed to modify privileged profile columns". This is a
-- sanctioned DBA repair, so we disable that ONE trigger for the two UPDATEs and
-- re-enable it, all inside a transaction so a failure rolls the disable back too.
-- The FK and every other trigger stay active; the guard's runtime protection for
-- regular authenticated users is unchanged.

BEGIN;

ALTER TABLE public.profiles DISABLE TRIGGER guard_profile_privileged_cols;

-- 1) Direct email match: profile email == teachers.email.
UPDATE public.profiles p
SET teacher_id = t.id
FROM public.teachers t
WHERE p.role = 'teacher'
  AND p.teacher_id IS NULL
  AND p.email IS NOT NULL
  AND t.email IS NOT NULL
  AND lower(p.email) = lower(t.email);

-- 2) Fallback via the staff_members link, for teachers whose teachers.email is
--    blank but whose staff_members row carries the email used to log in.
UPDATE public.profiles p
SET teacher_id = t.id
FROM public.teachers t
JOIN public.staff_members s ON s.id = t.staff_member_id
WHERE p.role = 'teacher'
  AND p.teacher_id IS NULL
  AND p.email IS NOT NULL
  AND s.email IS NOT NULL
  AND lower(p.email) = lower(s.email);

ALTER TABLE public.profiles ENABLE TRIGGER guard_profile_privileged_cols;

COMMIT;

-- Surface any teacher accounts still unlinked after both passes (e.g. no teachers
-- row was ever created for them). These need a manual "Convert to teacher" + relink.
DO $$
DECLARE
  orphan_count integer;
BEGIN
  SELECT count(*) INTO orphan_count
  FROM public.profiles
  WHERE role = 'teacher' AND teacher_id IS NULL;
  IF orphan_count > 0 THEN
    RAISE NOTICE 'migration-062: % teacher profile(s) still have a NULL teacher_id; convert their staff member to a teacher and recreate/relink.', orphan_count;
  END IF;
END $$;


-- ============================================================
-- migration-068-identity-integrity.sql
-- ============================================================
-- Migration 068: Identity & cross-role linking integrity (cross: base profiles + ERP domain)
--
-- Root cause of the "linking parent to ward did not work" incident: a profile
-- could exist as role='parent' with parent_id = NULL (and the same for teacher),
-- linking was done by 5 independent code paths, there was no 1:1 guarantee
-- between an auth account and a domain record, and nothing surfaced the broken
-- state. This migration installs the integrity FLOOR that the linking service
-- (Phase 1) and the admin reconciliation surface (Phase 2) build on.
--
-- It is a `cross` migration because it constrains `profiles` (base) using its
-- FKs into teachers/students/parents and student_parents (ERP). It is only
-- meaningful on a full ERP deployment.
--
-- SAFE TO APPLY ON A LIVE DB:
--   * The role↔link trigger fires only on INSERT and on UPDATEs that actually
--     change role or a link column, so it never rejects unrelated edits to
--     existing orphan rows and never fails on apply.
--   * The UNIQUE link indexes are guarded by a pre-check that raises a clear,
--     itemised error (pointing at profile_link_health) if duplicate claims
--     exist, instead of failing with an opaque index-build error. Resolve the
--     duplicates, then re-run — the whole file is idempotent.
--
-- Composes with migration 061: that guard blocks NON-privileged callers from
-- touching role/link columns at all; this migration constrains WHAT the
-- privileged (admin / service-role) linking paths are allowed to commit.

-- ============================================================
-- 0.1 / 0.2 — Observability: link-health view
-- ============================================================
-- One row per anomaly. `category` partitions errors from informational signals:
--   ERROR (must fix): orphaned_profile, role_link_mismatch, duplicate_*_claim
--   INFO  (expected, surfaced for onboarding): unclaimed_student,
--         parent_without_children, student_without_guardian_account
CREATE OR REPLACE VIEW public.profile_link_health AS
  -- role demands a link but it is NULL (the incident class: parent/teacher)
  SELECT 'orphaned_profile'::text AS category,
         p.id::text               AS subject_id,
         COALESCE(p.full_name, p.email) AS subject_label,
         ('role=' || p.role || ' but ' || p.role || '_id is NULL') AS detail
  FROM public.profiles p
  WHERE (p.role = 'teacher' AND p.teacher_id IS NULL)
     OR (p.role = 'parent'  AND p.parent_id  IS NULL)

  UNION ALL
  -- a student account that has not yet claimed its student record (self-claim
  -- model — expected for fresh accounts, informational)
  SELECT 'unclaimed_student', p.id::text, COALESCE(p.full_name, p.email),
         'role=student but student_id is NULL (awaiting self-link)'
  FROM public.profiles p
  WHERE p.role = 'student' AND p.student_id IS NULL

  UNION ALL
  -- a non-null link that does not match the profile's role (admin may also hold
  -- a teacher_id when a head/principal teaches; everything else is a mismatch)
  SELECT 'role_link_mismatch', p.id::text, COALESCE(p.full_name, p.email),
         'non-null link inconsistent with role=' || p.role
  FROM public.profiles p
  WHERE (p.student_id IS NOT NULL AND p.role <> 'student')
     OR (p.parent_id  IS NOT NULL AND p.role <> 'parent')
     OR (p.teacher_id IS NOT NULL AND p.role NOT IN ('teacher', 'admin'))

  UNION ALL
  -- two or more accounts claiming the same teacher record
  SELECT 'duplicate_teacher_claim', p.teacher_id::text, t.full_name,
         count(*) || ' accounts linked to this teacher record'
  FROM public.profiles p JOIN public.teachers t ON t.id = p.teacher_id
  WHERE p.teacher_id IS NOT NULL
  GROUP BY p.teacher_id, t.full_name HAVING count(*) > 1

  UNION ALL
  -- two or more accounts claiming the same student record
  SELECT 'duplicate_student_claim', p.student_id::text, s.full_name,
         count(*) || ' accounts linked to this student record'
  FROM public.profiles p JOIN public.students s ON s.id = p.student_id
  WHERE p.student_id IS NOT NULL
  GROUP BY p.student_id, s.full_name HAVING count(*) > 1

  UNION ALL
  -- two or more accounts claiming the same parent record
  SELECT 'duplicate_parent_claim', p.parent_id::text, pa.full_name,
         count(*) || ' accounts linked to this parent record'
  FROM public.profiles p JOIN public.parents pa ON pa.id = p.parent_id
  WHERE p.parent_id IS NOT NULL
  GROUP BY p.parent_id, pa.full_name HAVING count(*) > 1

  UNION ALL
  -- an active parent record with no children linked (orphaned guardian record)
  SELECT 'parent_without_children', pa.id::text, pa.full_name,
         'active parent record has no student_parents links'
  FROM public.parents pa
  WHERE COALESCE(pa.is_active, true)
    AND NOT EXISTS (SELECT 1 FROM public.student_parents sp WHERE sp.parent_id = pa.id)

  UNION ALL
  -- an active, non-alumni student whose guardians have no portal account yet
  -- (onboarding signal — the parent can't see results/fees until they sign up)
  SELECT 'student_without_guardian_account', s.id::text, s.full_name,
         'active student has no linked parent with a portal account'
  FROM public.students s
  WHERE COALESCE(s.is_active, true) AND NOT COALESCE(s.is_alumni, false)
    AND NOT EXISTS (
      SELECT 1 FROM public.student_parents sp
      JOIN public.profiles p ON p.parent_id = sp.parent_id
      WHERE sp.student_id = s.id
    );

COMMENT ON VIEW public.profile_link_health IS
  'Cross-role linking anomalies. ERROR categories (orphaned_profile, '
  'role_link_mismatch, duplicate_*_claim) must be resolved; INFO categories '
  '(unclaimed_student, parent_without_children, student_without_guardian_account) '
  'are onboarding signals. Read via GET /api/admin/link-health.';

-- ============================================================
-- 0.3 — Enforce 1:1 between an auth account and a domain record
-- ============================================================
-- Pre-flight: refuse to build UNIQUE indexes if duplicate claims exist, with a
-- clear, actionable message instead of an opaque "could not create unique index".
DO $$
DECLARE
  dup_count integer;
BEGIN
  SELECT count(*) INTO dup_count FROM (
    SELECT teacher_id FROM public.profiles WHERE teacher_id IS NOT NULL
      GROUP BY teacher_id HAVING count(*) > 1
    UNION ALL
    SELECT student_id FROM public.profiles WHERE student_id IS NOT NULL
      GROUP BY student_id HAVING count(*) > 1
    UNION ALL
    SELECT parent_id  FROM public.profiles WHERE parent_id  IS NOT NULL
      GROUP BY parent_id  HAVING count(*) > 1
  ) d;

  IF dup_count > 0 THEN
    RAISE EXCEPTION
      'Cannot enforce 1:1 link uniqueness: % duplicate claim(s) exist. '
      'Run  SELECT * FROM public.profile_link_health WHERE category LIKE ''duplicate%%'';  '
      'resolve them (unlink the wrong account), then re-run this migration.',
      dup_count;
  END IF;
END $$;

-- Replace the plain partial indexes (migration 001 / erp-redesign) with UNIQUE
-- partial indexes. Same WHERE clause, so they still serve the lookup queries.
DROP INDEX IF EXISTS idx_profiles_teacher_id;
DROP INDEX IF EXISTS idx_profiles_student_id;
DROP INDEX IF EXISTS idx_profiles_parent_id;

CREATE UNIQUE INDEX idx_profiles_teacher_id
  ON public.profiles(teacher_id) WHERE teacher_id IS NOT NULL;
CREATE UNIQUE INDEX idx_profiles_student_id
  ON public.profiles(student_id) WHERE student_id IS NOT NULL;
CREATE UNIQUE INDEX idx_profiles_parent_id
  ON public.profiles(parent_id) WHERE parent_id IS NOT NULL;

-- ============================================================
-- 0.4 — Enforce role ↔ link consistency
-- ============================================================
-- Invariants (the linking service in Phase 1 sets role + link in ONE update,
-- so it always satisfies these):
--   role='teacher' ⇒ teacher_id IS NOT NULL
--   role='parent'  ⇒ parent_id  IS NOT NULL
--   role='student' ⇒ student_id MAY be NULL (self-claim model)
--   a non-null link must match the role (admins may also hold a teacher_id)
--   admin/staff carry no student_id/parent_id
--
-- NOT exempt for service-role: a buggy server path that sets role='parent'
-- without a parent_id SHOULD fail loudly — that is the whole point.
CREATE OR REPLACE FUNCTION public.enforce_profile_role_link()
RETURNS TRIGGER AS $$
BEGIN
  -- On UPDATE, skip when neither role nor any link column changed, so routine
  -- edits (phone, avatar) to a pre-existing anomalous row are never blocked —
  -- only attempts to commit/keep an inconsistent role+link combination are.
  IF TG_OP = 'UPDATE'
     AND NEW.role       IS NOT DISTINCT FROM OLD.role
     AND NEW.teacher_id IS NOT DISTINCT FROM OLD.teacher_id
     AND NEW.student_id IS NOT DISTINCT FROM OLD.student_id
     AND NEW.parent_id  IS NOT DISTINCT FROM OLD.parent_id THEN
    RETURN NEW;
  END IF;

  IF NEW.role = 'teacher' AND NEW.teacher_id IS NULL THEN
    RAISE EXCEPTION 'profile %: role=teacher requires teacher_id (use the linking service)', NEW.id;
  END IF;
  IF NEW.role = 'parent' AND NEW.parent_id IS NULL THEN
    RAISE EXCEPTION 'profile %: role=parent requires parent_id (use the linking service)', NEW.id;
  END IF;

  IF NEW.student_id IS NOT NULL AND NEW.role <> 'student' THEN
    RAISE EXCEPTION 'profile %: student_id set but role=% (must be student)', NEW.id, NEW.role;
  END IF;
  IF NEW.parent_id IS NOT NULL AND NEW.role <> 'parent' THEN
    RAISE EXCEPTION 'profile %: parent_id set but role=% (must be parent)', NEW.id, NEW.role;
  END IF;
  IF NEW.teacher_id IS NOT NULL AND NEW.role NOT IN ('teacher', 'admin') THEN
    RAISE EXCEPTION 'profile %: teacher_id set but role=% (must be teacher or admin)', NEW.id, NEW.role;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS enforce_profile_role_link ON public.profiles;
CREATE TRIGGER enforce_profile_role_link
  BEFORE INSERT OR UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.enforce_profile_role_link();

-- ============================================================
-- 0.5 — Single source of truth for the parent↔ward relationship
-- ============================================================
-- student_parents.relationship is the authoritative per-link relationship
-- (a person can be 'father' to one child and 'guardian' to another).
-- parents.relationship is now deprecated: kept for backward compatibility but
-- no longer written by the linking service and not read by the app.
COMMENT ON COLUMN public.parents.relationship IS
  'DEPRECATED (migration 068). The authoritative relationship lives per-link in '
  'student_parents.relationship. This column is retained only for backward '
  'compatibility and must not be read by application code.';


-- ============================================================
-- migration-069-timetable-classsubject-drift.sql
-- ============================================================
-- Migration 069: Surface teacher-assignment drift between timetable & class_subjects
--
-- Decision (Phase 3): `class_subjects` is the CANONICAL authority for "which
-- teacher teaches which subject in which class" — it's what teacher-scope.ts
-- and the RLS get_my_class_ids() helper read. `timetable_periods` is the
-- schedule and can drift (a period assigned to a different teacher than the
-- subject's class_subjects.teacher_id), which would let the timetable show one
-- teacher while scope/authorization uses another.
--
-- This view makes that drift observable so it can be reconciled. It does NOT
-- auto-rewrite timetable rows — period-level cover/substitution is sometimes
-- legitimate; the admin decides. Read-only, safe to apply on a live DB.

CREATE OR REPLACE VIEW public.timetable_assignment_drift AS
  SELECT tp.id              AS timetable_period_id,
         tp.class_id,
         c.name             AS class_name,
         c.section          AS class_section,
         tp.subject_id,
         s.name             AS subject_name,
         tp.day_of_week,
         tp.period_number,
         tp.teacher_id      AS timetable_teacher_id,
         tt.full_name       AS timetable_teacher_name,
         cs.teacher_id      AS canonical_teacher_id,
         ct.full_name       AS canonical_teacher_name
  FROM public.timetable_periods tp
  JOIN public.class_subjects cs
    ON cs.class_id = tp.class_id AND cs.subject_id = tp.subject_id
  LEFT JOIN public.classes  c  ON c.id  = tp.class_id
  LEFT JOIN public.subjects s  ON s.id  = tp.subject_id
  LEFT JOIN public.teachers tt ON tt.id = tp.teacher_id
  LEFT JOIN public.teachers ct ON ct.id = cs.teacher_id
  WHERE tp.is_break IS NOT TRUE
    AND tp.teacher_id IS DISTINCT FROM cs.teacher_id;

COMMENT ON VIEW public.timetable_assignment_drift IS
  'Timetable periods whose teacher differs from the canonical class_subjects '
  'assignment for the same (class, subject). class_subjects is authoritative '
  '(migration 069); rows here are drift to reconcile (or legitimate cover).';


-- ============================================================
-- migration-071-timetable-teacher-time-overlap.sql
-- ============================================================
-- =============================================================
-- Migration 071: timetable teacher clash = TIME OVERLAP, not period number
-- =============================================================
-- Classes run on STAGGERED schedules — "period 3" in one class is a different
-- wall-clock time than "period 3" in another. The old uniqueness index
-- (teacher_id, day_of_week, period_number) modelled clashes by period number,
-- which BOTH rejected valid non-overlapping staggered periods that happen to
-- share a number AND allowed genuine double-bookings across different numbers.
--
-- This replaces it with a true time-overlap exclusion constraint.
--
-- ⚠️  PRE-CHECK BEFORE APPLYING: this constraint will FAIL to create if the
--     live data already contains overlapping periods for a teacher (the old
--     index permitted them). Run this first and resolve any rows it returns:
--
--       SELECT a.teacher_id, a.day_of_week,
--              a.id AS period_a, a.start_time AS a_start, a.end_time AS a_end,
--              b.id AS period_b, b.start_time AS b_start, b.end_time AS b_end
--       FROM timetable_periods a
--       JOIN timetable_periods b
--         ON a.teacher_id = b.teacher_id
--        AND a.day_of_week = b.day_of_week
--        AND a.id < b.id
--        AND a.teacher_id IS NOT NULL
--        AND a.is_break IS NOT TRUE AND b.is_break IS NOT TRUE
--        AND a.start_time < b.end_time
--        AND a.end_time > b.start_time;
--
-- SAFE TO RE-RUN.
-- =============================================================

BEGIN;

-- btree_gist lets a GiST exclusion constraint mix equality (teacher_id,
-- day_of_week) with the range-overlap operator.
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- Drop the period_number-based teacher uniqueness — wrong model.
DROP INDEX IF EXISTS idx_timetable_teacher_slot_unique;

-- A teacher cannot occupy two periods whose wall-clock ranges overlap on the
-- same weekday. Postgres has no built-in range type for `time`, so times are
-- anchored to a fixed date and compared as tsrange. Breaks / free (teacher_id
-- NULL) rows are exempt.
-- NOTE: the predicate also requires start_time < end_time. tsrange() errors on
-- a lower bound greater than the upper bound, so any degenerate row
-- (end_time <= start_time, i.e. bad legacy data) must be excluded from the
-- index — otherwise CREATE CONSTRAINT fails with "range lower bound must be
-- less than or equal to range upper bound". Such rows are invalid and can't
-- meaningfully overlap anything; the app validates end > start on writes.
-- Find any offenders with:
--   SELECT id, class_id, day_of_week, period_number, start_time, end_time
--   FROM timetable_periods WHERE end_time <= start_time;
ALTER TABLE timetable_periods
  DROP CONSTRAINT IF EXISTS timetable_teacher_no_overlap;
ALTER TABLE timetable_periods
  ADD CONSTRAINT timetable_teacher_no_overlap
  EXCLUDE USING gist (
    teacher_id WITH =,
    day_of_week WITH =,
    tsrange('2000-01-01'::date + start_time, '2000-01-01'::date + end_time) WITH &&
  ) WHERE (teacher_id IS NOT NULL AND is_break IS NOT TRUE AND start_time < end_time);

COMMIT;


-- ============================================================
-- migration-081-backfill-teacher-records.sql
-- ============================================================
-- Migration 081 — backfill teachers records for existing teaching staff.
--
-- Teaching staff are now given a linked `teachers` record on add (so they're
-- assignable to classes/timetable/attendance) regardless of whether they get a
-- login. Staff added before that change only got a teacher record if they were
-- given a login (email present) or if an admin clicked "Convert to teacher".
-- This one-time backfill creates the missing records for every active teaching
-- staff member not yet linked.
--
-- Field mapping mirrors promoteStaffToTeacher() in lib/staff-teacher-sync.ts:
-- name→full_name and the shared contact/personal fields; employee_id is a
-- unique auto-generated 'TCH-BF-…' value (BF = backfill).
--
-- Idempotent: the NOT EXISTS guard skips any staff already linked to a teacher,
-- so re-running creates nothing new.

INSERT INTO teachers (
  employee_id, full_name, email, phone, date_of_birth,
  address, qualifications, photo_url, staff_member_id
)
SELECT
  'TCH-BF-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10)),
  s.name,
  s.email,
  s.phone,
  s.date_of_birth,
  s.address,
  s.qualifications,
  s.photo_url,
  s.id
FROM staff_members s
WHERE s.is_active = true
  AND s.category IN (
    'pgt', 'tgt', 'prt', 'motherTeachers',
    'prePrimaryCoordinator', 'primaryCoordinator',
    'middleCoordinator', 'seniorCoordinator'
  )
  AND NOT EXISTS (
    SELECT 1 FROM teachers t WHERE t.staff_member_id = s.id
  );


-- ============================================================
-- migration-083-teachers-staff-member-unique.sql
-- ============================================================
-- Migration 083: Enforce one teacher row per staff member
--
-- Why: promoteStaffToTeacher() (apps/erp/src/lib/staff-teacher-sync.ts) guards
-- against duplicates with a non-atomic select-then-insert, and teachers has no
-- uniqueness on staff_member_id. Two concurrent provisioning actions for the
-- same staff member (auto-create-on-add + "Convert to teacher" click) can both
-- see no existing row and both insert, yielding two teachers rows for one staff
-- member — the person then appears twice in every teacher picker.
--
-- Fix: a partial UNIQUE index on teachers(staff_member_id) WHERE staff_member_id
-- IS NOT NULL. Combined with the 23505-retry now handled in promoteStaffToTeacher,
-- provisioning becomes idempotent under concurrency.
--
-- Safety: this migration will NOT create the index (and will NOT fail) if
-- duplicate rows already exist — it raises a NOTICE listing the offending
-- staff_member_ids instead. Deduplicating existing teachers rows is intentionally
-- left manual because those rows may be referenced by timetable_periods,
-- classes.class_teacher_id, teacher_subjects, etc., and consolidating them
-- requires repointing those FKs deliberately. Once any duplicates are resolved,
-- re-run this migration to create the index.

DO $$
DECLARE
  dup_ids text;
BEGIN
  SELECT string_agg(staff_member_id::text, ', ')
    INTO dup_ids
  FROM (
    SELECT staff_member_id
    FROM teachers
    WHERE staff_member_id IS NOT NULL
    GROUP BY staff_member_id
    HAVING count(*) > 1
  ) d;

  IF dup_ids IS NOT NULL THEN
    RAISE NOTICE 'Skipping unique index: duplicate teachers rows exist for staff_member_id(s): %. Resolve these first, then re-run migration 083.', dup_ids;
  ELSE
    CREATE UNIQUE INDEX IF NOT EXISTS idx_teachers_staff_member_id_unique
      ON teachers(staff_member_id)
      WHERE staff_member_id IS NOT NULL;
    RAISE NOTICE 'Created partial unique index idx_teachers_staff_member_id_unique.';
  END IF;
END $$;


-- ============================================================
-- migration-060-content-rls-hardening.sql
-- ============================================================
-- Migration 060: Harden content-table RLS (articles + gallery_images)
--
-- Why: both tables had policies that any *authenticated* user could exploit.
--   - articles INSERT/UPDATE/DELETE were `TO authenticated WITH CHECK (true)`,
--     so any ERP parent/student/teacher JWT could deface or delete articles
--     directly via the anon client, bypassing CMS permission checks.
--   - gallery_images SELECT was `USING (true)`, exposing images that belong to
--     PRIVATE (is_public = false) gallery events to anyone with the public anon key.
--
-- Safe to apply: all CMS writes go through the service-role client
-- (verifyAdminOrEditor), which bypasses RLS — so tightening these policies does
-- not affect the admin/editor experience. The public website reads articles via
-- the service-role client and reads gallery_images via the anon client (standalone
-- images + public-event images only), both of which remain functional below.

-- ============================================================
-- articles: writes are admin/staff only
-- ============================================================
DROP POLICY IF EXISTS "Authenticated can insert articles" ON articles;
DROP POLICY IF EXISTS "Authenticated can update articles" ON articles;
DROP POLICY IF EXISTS "Authenticated can delete articles" ON articles;

CREATE POLICY "Staff can insert articles"
  ON articles FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin', 'staff'))
  );

CREATE POLICY "Staff can update articles"
  ON articles FOR UPDATE TO authenticated
  USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin', 'staff'))
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin', 'staff'))
  );

CREATE POLICY "Staff can delete articles"
  ON articles FOR DELETE TO authenticated
  USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin', 'staff'))
  );

-- ============================================================
-- gallery_images: public SELECT limited to non-private images
-- ============================================================
DROP POLICY IF EXISTS "Public can view gallery images" ON gallery_images;

CREATE POLICY "Public can view public gallery images"
  ON gallery_images FOR SELECT
  USING (
    -- Standalone images (not tied to any event) are general public gallery items.
    gallery_event_id IS NULL
    -- Event images are visible only when their event is public.
    OR EXISTS (
      SELECT 1 FROM gallery_events e
      WHERE e.id = gallery_images.gallery_event_id AND e.is_public = true
    )
  );


-- ============================================================
-- migration-082-harden-content-write-rls.sql
-- ============================================================
-- Migration 082: Harden write RLS on public content tables
--
-- Why: these tables all had write (and in two cases read) policies guarded only
-- by `auth.role() = 'authenticated'`. Because the ERP, CMS and website share one
-- Supabase project, EVERY parent/student/teacher holds an 'authenticated' JWT
-- usable with the public anon key. Any of them could therefore insert/update/
-- delete these rows directly through the anon client, bypassing all CMS
-- admin/editor gating:
--   - transfer_certificates: INSERT/DELETE were authenticated-only (UPDATE was
--     already admin-scoped by migration-013, SELECT by migration-044).
--   - contact_submissions: SELECT + UPDATE were authenticated-only, leaking
--     prospective-family PII (name/email/phone/message) to any ERP user.
--   - site_media / section_cards / staff_members / gallery_images: INSERT/
--     UPDATE/DELETE were authenticated-only (migration-060 hardened only
--     articles + gallery_images SELECT, not these write policies).
--   - disclosure_items / disclosure_documents / disclosure_board_results: the
--     legally-mandated CBSE public disclosure data was INSERT/UPDATE/DELETE-able
--     by any authenticated user.
--
-- Fix: restrict writes (and the contact_submissions read/update) to admins and
-- editors (role IN ('admin','staff')), matching migration-060's articles pattern.
-- These are all CMS editor features (gallery, transfer_certificates, contact,
-- site_media, disclosure, staff), so 'staff' is the correct editor role.
--
-- Safe to apply: all legitimate CMS writes go through the service-role admin
-- proxy (verifyAdminOrEditor), which bypasses RLS entirely — tightening these
-- policies does not affect the admin/editor experience. Public SELECT policies
-- (USING (true) / authenticated read) on section_cards/site_media/staff_members/
-- disclosure_* are intentionally left unchanged so the public website keeps
-- working; only the write policies (and contact_submissions' PII read/update)
-- are hardened here.

-- ============================================================
-- transfer_certificates: INSERT/DELETE admin/staff only
-- ============================================================
DROP POLICY IF EXISTS "Authenticated users can insert transfer certificates" ON transfer_certificates;
DROP POLICY IF EXISTS "Authenticated users can delete transfer certificates" ON transfer_certificates;

CREATE POLICY "Staff can insert transfer certificates"
  ON transfer_certificates FOR INSERT TO authenticated
  WITH CHECK (public.get_user_role() IN ('admin', 'staff'));

CREATE POLICY "Staff can delete transfer certificates"
  ON transfer_certificates FOR DELETE TO authenticated
  USING (public.get_user_role() IN ('admin', 'staff'));

-- ============================================================
-- contact_submissions: SELECT/UPDATE admin/staff only (PII)
-- ============================================================
DROP POLICY IF EXISTS "Authenticated users can view contact submissions" ON contact_submissions;
DROP POLICY IF EXISTS "Authenticated users can update contact submissions" ON contact_submissions;

CREATE POLICY "Staff can view contact submissions"
  ON contact_submissions FOR SELECT TO authenticated
  USING (public.get_user_role() IN ('admin', 'staff'));

CREATE POLICY "Staff can update contact submissions"
  ON contact_submissions FOR UPDATE TO authenticated
  USING (public.get_user_role() IN ('admin', 'staff'))
  WITH CHECK (public.get_user_role() IN ('admin', 'staff'));

-- ============================================================
-- site_media: INSERT/UPDATE admin/staff only
-- ============================================================
DROP POLICY IF EXISTS "Authenticated users can insert site_media" ON site_media;
DROP POLICY IF EXISTS "Authenticated users can update site_media" ON site_media;

CREATE POLICY "Staff can insert site_media"
  ON site_media FOR INSERT TO authenticated
  WITH CHECK (public.get_user_role() IN ('admin', 'staff'));

CREATE POLICY "Staff can update site_media"
  ON site_media FOR UPDATE TO authenticated
  USING (public.get_user_role() IN ('admin', 'staff'))
  WITH CHECK (public.get_user_role() IN ('admin', 'staff'));

-- ============================================================
-- section_cards: INSERT/UPDATE/DELETE admin/staff only
-- ============================================================
DROP POLICY IF EXISTS "Authenticated users can insert section_cards" ON section_cards;
DROP POLICY IF EXISTS "Authenticated users can update section_cards" ON section_cards;
DROP POLICY IF EXISTS "Authenticated users can delete section_cards" ON section_cards;

CREATE POLICY "Staff can insert section_cards"
  ON section_cards FOR INSERT TO authenticated
  WITH CHECK (public.get_user_role() IN ('admin', 'staff'));

CREATE POLICY "Staff can update section_cards"
  ON section_cards FOR UPDATE TO authenticated
  USING (public.get_user_role() IN ('admin', 'staff'))
  WITH CHECK (public.get_user_role() IN ('admin', 'staff'));

CREATE POLICY "Staff can delete section_cards"
  ON section_cards FOR DELETE TO authenticated
  USING (public.get_user_role() IN ('admin', 'staff'));

-- ============================================================
-- staff_members: INSERT/UPDATE/DELETE admin/staff only
-- ============================================================
DROP POLICY IF EXISTS "Authenticated users can insert staff members" ON staff_members;
DROP POLICY IF EXISTS "Authenticated users can update staff members" ON staff_members;
DROP POLICY IF EXISTS "Authenticated users can delete staff members" ON staff_members;

CREATE POLICY "Staff can insert staff members"
  ON staff_members FOR INSERT TO authenticated
  WITH CHECK (public.get_user_role() IN ('admin', 'staff'));

CREATE POLICY "Staff can update staff members"
  ON staff_members FOR UPDATE TO authenticated
  USING (public.get_user_role() IN ('admin', 'staff'))
  WITH CHECK (public.get_user_role() IN ('admin', 'staff'));

CREATE POLICY "Staff can delete staff members"
  ON staff_members FOR DELETE TO authenticated
  USING (public.get_user_role() IN ('admin', 'staff'));

-- ============================================================
-- gallery_images: INSERT/UPDATE/DELETE admin/staff only
-- ============================================================
DROP POLICY IF EXISTS "Authenticated users can insert gallery images" ON gallery_images;
DROP POLICY IF EXISTS "Authenticated users can update gallery images" ON gallery_images;
DROP POLICY IF EXISTS "Authenticated users can delete gallery images" ON gallery_images;

CREATE POLICY "Staff can insert gallery images"
  ON gallery_images FOR INSERT TO authenticated
  WITH CHECK (public.get_user_role() IN ('admin', 'staff'));

CREATE POLICY "Staff can update gallery images"
  ON gallery_images FOR UPDATE TO authenticated
  USING (public.get_user_role() IN ('admin', 'staff'))
  WITH CHECK (public.get_user_role() IN ('admin', 'staff'));

CREATE POLICY "Staff can delete gallery images"
  ON gallery_images FOR DELETE TO authenticated
  USING (public.get_user_role() IN ('admin', 'staff'));

-- ============================================================
-- disclosure_items / disclosure_documents / disclosure_board_results:
-- INSERT/UPDATE/DELETE admin/staff only (CBSE mandatory disclosure)
-- ============================================================
DROP POLICY IF EXISTS "Authenticated users can insert disclosure_items" ON disclosure_items;
DROP POLICY IF EXISTS "Authenticated users can update disclosure_items" ON disclosure_items;
DROP POLICY IF EXISTS "Authenticated users can delete disclosure_items" ON disclosure_items;

CREATE POLICY "Staff can insert disclosure_items"
  ON disclosure_items FOR INSERT TO authenticated
  WITH CHECK (public.get_user_role() IN ('admin', 'staff'));

CREATE POLICY "Staff can update disclosure_items"
  ON disclosure_items FOR UPDATE TO authenticated
  USING (public.get_user_role() IN ('admin', 'staff'))
  WITH CHECK (public.get_user_role() IN ('admin', 'staff'));

CREATE POLICY "Staff can delete disclosure_items"
  ON disclosure_items FOR DELETE TO authenticated
  USING (public.get_user_role() IN ('admin', 'staff'));

DROP POLICY IF EXISTS "Authenticated users can insert disclosure_documents" ON disclosure_documents;
DROP POLICY IF EXISTS "Authenticated users can update disclosure_documents" ON disclosure_documents;
DROP POLICY IF EXISTS "Authenticated users can delete disclosure_documents" ON disclosure_documents;

CREATE POLICY "Staff can insert disclosure_documents"
  ON disclosure_documents FOR INSERT TO authenticated
  WITH CHECK (public.get_user_role() IN ('admin', 'staff'));

CREATE POLICY "Staff can update disclosure_documents"
  ON disclosure_documents FOR UPDATE TO authenticated
  USING (public.get_user_role() IN ('admin', 'staff'))
  WITH CHECK (public.get_user_role() IN ('admin', 'staff'));

CREATE POLICY "Staff can delete disclosure_documents"
  ON disclosure_documents FOR DELETE TO authenticated
  USING (public.get_user_role() IN ('admin', 'staff'));

DROP POLICY IF EXISTS "Authenticated users can insert disclosure_board_results" ON disclosure_board_results;
DROP POLICY IF EXISTS "Authenticated users can update disclosure_board_results" ON disclosure_board_results;
DROP POLICY IF EXISTS "Authenticated users can delete disclosure_board_results" ON disclosure_board_results;

CREATE POLICY "Staff can insert disclosure_board_results"
  ON disclosure_board_results FOR INSERT TO authenticated
  WITH CHECK (public.get_user_role() IN ('admin', 'staff'));

CREATE POLICY "Staff can update disclosure_board_results"
  ON disclosure_board_results FOR UPDATE TO authenticated
  USING (public.get_user_role() IN ('admin', 'staff'))
  WITH CHECK (public.get_user_role() IN ('admin', 'staff'));

CREATE POLICY "Staff can delete disclosure_board_results"
  ON disclosure_board_results FOR DELETE TO authenticated
  USING (public.get_user_role() IN ('admin', 'staff'));

