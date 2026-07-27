-- Migration 077: make the seeded stop fees available in the CURRENT session.
--
-- The 188-stop seed (migration 075) attached the fees to the year named
-- '2025-26' (the label on the school's fee sheet). If the school is now
-- operating a later session (e.g. 2026-27), the Stops & Fees page — which shows
-- the current academic year — finds no fees and renders every amount as "—".
--
-- This copies the most recent year's stop fees into the current academic year
-- when the current year has none yet. Idempotent and safe to re-run: it does
-- nothing if the current year already has fees, or if there are none to copy.
-- After running, re-price the current year on Stops & Fees if diesel/fares
-- changed for the new session.

begin;

do $$
declare
  current_year uuid;
  source_year  uuid;
  copied       int;
begin
  select id into current_year
    from academic_years
    where is_current = true
    limit 1;

  if current_year is null then
    raise notice 'migration 077: no current academic year set; nothing to do.';
    return;
  end if;

  if exists (select 1 from bus_stop_fees where academic_year_id = current_year) then
    raise notice 'migration 077: current year already has stop fees; nothing to do.';
    return;
  end if;

  -- Newest year (by start_date) that actually has stop fees — the seeded one.
  select bsf.academic_year_id into source_year
    from bus_stop_fees bsf
    join academic_years ay on ay.id = bsf.academic_year_id
    group by bsf.academic_year_id, ay.start_date
    order by ay.start_date desc
    limit 1;

  if source_year is null then
    raise notice 'migration 077: no bus_stop_fees exist to copy from; run migration 075 first.';
    return;
  end if;

  insert into bus_stop_fees (bus_stop_id, academic_year_id, amount, frequency, is_active)
    select bus_stop_id, current_year, amount, frequency, is_active
    from bus_stop_fees
    where academic_year_id = source_year
  on conflict (bus_stop_id, academic_year_id) do nothing;

  get diagnostics copied = row_count;
  raise notice 'migration 077: copied % stop fee(s) into the current academic year.', copied;
end $$;

commit;
