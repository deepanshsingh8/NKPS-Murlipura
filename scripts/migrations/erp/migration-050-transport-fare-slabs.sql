-- Migration 050: Distance-based transport fare slabs.
--
-- Replaces the flat `Transport` row in `fee_structures` with a per-academic-
-- year master table of distance slabs. Each `student_enrollments` row points
-- at one slab when `has_transport = true`; `fee_payments` gains a slab FK so
-- transport receipts no longer need a fake fee_structure row.
--
-- Idempotent — safe to re-run after a partial failure.
--
-- Order matters: we add the student_enrollments CHECK constraint LAST,
-- after the backfill assigns slab ids and we normalize any orphans
-- (has_transport=true rows whose class never had a Transport fee defined).
-- Adding the CHECK earlier would fail on those orphans.

begin;

-- ─────────────────────────────────────────────────────────────────
-- 1. transport_fare_slabs master
-- ─────────────────────────────────────────────────────────────────
create table if not exists transport_fare_slabs (
  id                uuid default gen_random_uuid() primary key,
  academic_year_id  uuid not null references academic_years(id) on delete cascade,
  name              text not null,
  distance_km_min   numeric(5,2),
  distance_km_max   numeric(5,2),
  amount            numeric(10,2) not null check (amount > 0),
  frequency         text not null default 'monthly'
                    check (frequency in ('monthly','quarterly','annual','one_time')),
  is_active         boolean not null default true,
  sort_order        integer not null default 0,
  created_at        timestamptz default now(),
  updated_at        timestamptz default now(),
  unique (academic_year_id, name),
  check (
    distance_km_min is null
    or distance_km_max is null
    or distance_km_max >= distance_km_min
  )
);

create index if not exists idx_transport_slabs_year
  on transport_fare_slabs(academic_year_id);
create index if not exists idx_transport_slabs_active
  on transport_fare_slabs(academic_year_id) where is_active;

drop trigger if exists set_updated_at_transport_fare_slabs on transport_fare_slabs;
create trigger set_updated_at_transport_fare_slabs
  before update on transport_fare_slabs
  for each row execute function public.set_updated_at();

alter table transport_fare_slabs enable row level security;

drop policy if exists "Public can read transport slabs" on transport_fare_slabs;
create policy "Public can read transport slabs"
  on transport_fare_slabs for select
  using (true);

drop policy if exists "Admins can insert transport slabs" on transport_fare_slabs;
create policy "Admins can insert transport slabs"
  on transport_fare_slabs for insert
  with check (public.get_user_role() = 'admin');

drop policy if exists "Admins can update transport slabs" on transport_fare_slabs;
create policy "Admins can update transport slabs"
  on transport_fare_slabs for update
  using (public.get_user_role() = 'admin');

drop policy if exists "Admins can delete transport slabs" on transport_fare_slabs;
create policy "Admins can delete transport slabs"
  on transport_fare_slabs for delete
  using (public.get_user_role() = 'admin');

-- ─────────────────────────────────────────────────────────────────
-- 2. student_enrollments.transport_slab_id (column only — CHECK comes later)
-- ─────────────────────────────────────────────────────────────────
alter table student_enrollments
  add column if not exists transport_slab_id uuid
    references transport_fare_slabs(id) on delete set null;

create index if not exists idx_enrollments_transport_slab_id
  on student_enrollments(transport_slab_id) where transport_slab_id is not null;

-- Drop the CHECK if a previous failed run left it in place; we add it back
-- at the very end, after the backfill + orphan cleanup.
alter table student_enrollments
  drop constraint if exists student_enrollments_transport_slab_required;

-- ─────────────────────────────────────────────────────────────────
-- 3. fee_payments.transport_slab_id + nullable fee_structure_id + xor CHECK
-- ─────────────────────────────────────────────────────────────────
alter table fee_payments
  add column if not exists transport_slab_id uuid
    references transport_fare_slabs(id);

create index if not exists idx_fee_payments_transport_slab_id
  on fee_payments(transport_slab_id) where transport_slab_id is not null;

alter table fee_payments
  alter column fee_structure_id drop not null;

-- Exactly one of (fee_structure_id, transport_slab_id) must be set.
-- Pre-migration rows all satisfy this (fs not null, slab null), and the
-- backfill UPDATE flips both columns atomically so the constraint is safe
-- to add now.
alter table fee_payments
  drop constraint if exists fee_payments_target_xor;
alter table fee_payments
  add constraint fee_payments_target_xor
  check (
    (fee_structure_id is not null and transport_slab_id is null)
    or (fee_structure_id is null and transport_slab_id is not null)
  );

-- ─────────────────────────────────────────────────────────────────
-- 4. Backfill: Transport fee_structures → slabs → repoint payments → drop
-- ─────────────────────────────────────────────────────────────────
do $$
declare
  rec record;
  new_slab_id uuid;
  orphan_count int;
begin
  if exists (select 1 from fee_structures where fee_type = 'Transport') then
    -- One slab per (year, amount, frequency). The slab name lists every
    -- source class, so admins can audit what got merged.
    for rec in
      select
        academic_year_id,
        amount,
        frequency,
        string_agg(distinct class_name, ', ') as class_list,
        array_agg(distinct id) as source_structure_ids
      from fee_structures
      where fee_type = 'Transport'
      group by academic_year_id, amount, frequency
    loop
      insert into transport_fare_slabs
        (academic_year_id, name, amount, frequency, sort_order)
      values (
        rec.academic_year_id,
        'Default — ' || rec.class_list,
        rec.amount,
        rec.frequency,
        0
      )
      on conflict (academic_year_id, name) do update
        set amount = excluded.amount  -- harmless touch so RETURNING fires
      returning id into new_slab_id;

      -- Repoint dependent fee_payments at the new slab and clear the
      -- fee_structure pointer (xor check enforces this atomically).
      update fee_payments
        set transport_slab_id = new_slab_id,
            fee_structure_id  = null
        where fee_structure_id = any(rec.source_structure_ids);

      -- Backfill enrollments that opted into transport for any of these
      -- classes. Match by class.name → fee_structures.class_name and year.
      update student_enrollments se
        set transport_slab_id = new_slab_id
        from classes c, fee_structures fs
        where se.class_id = c.id
          and se.has_transport = true
          and se.transport_slab_id is null
          and se.academic_year_id = rec.academic_year_id
          and fs.id = any(rec.source_structure_ids)
          and fs.class_name = c.name;
    end loop;

    -- All transport payments now hold a slab; safe to drop the originals.
    delete from fee_structures where fee_type = 'Transport';
  end if;

  -- Normalize orphans: any enrollment still flagged has_transport=true
  -- without a slab means the class never had a Transport fee_structure
  -- row to migrate from. We can't invent a fare for them — flip the flag
  -- off so the school can re-opt them in once a slab is defined.
  select count(*) into orphan_count
    from student_enrollments
    where has_transport = true and transport_slab_id is null;

  if orphan_count > 0 then
    update student_enrollments
      set has_transport = false
      where has_transport = true and transport_slab_id is null;
    raise notice
      'migration 050: cleared has_transport on % enrollment(s) with no matching Transport fee. Re-opt them in via the admin UI after creating a slab.',
      orphan_count;
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────────
-- 5. NOW add the student_enrollments CHECK (post-backfill, post-cleanup)
-- ─────────────────────────────────────────────────────────────────
-- has_transport ⟹ transport_slab_id IS NOT NULL.
-- The reverse is allowed (a slab can stay assigned even after opt-out, so
-- toggling transport off then on again restores the previous slab).
alter table student_enrollments
  add constraint student_enrollments_transport_slab_required
  check (has_transport = false or transport_slab_id is not null);

commit;
