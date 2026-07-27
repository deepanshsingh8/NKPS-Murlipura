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
