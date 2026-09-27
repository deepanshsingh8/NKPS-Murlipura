-- migration-098-restrict-staff-pii.sql
--
-- URGENT. Closes an unauthenticated read of staff personal data.
--
-- `teachers` and `staff_members` each carried a policy of the form
--
--     CREATE POLICY "Public can read teachers" ON teachers
--       FOR SELECT USING (true);
--
-- A policy with no TO clause applies to PUBLIC, which includes the `anon`
-- role. The anon key is public by design — it ships inside the marketing
-- site's JavaScript bundle — so anyone on the internet could issue
-- `GET /rest/v1/teachers?select=*` and read, for every member of staff:
--
--   teachers       — aadhar_number, date_of_birth, address, phone, email
--   staff_members  — date_of_birth, address, phone, email, license_number
--
-- Aadhaar numbers and home addresses of employees, readable without logging
-- in. Under India's DPDP Act 2023 this is a reportable class of breach.
--
-- Why it went unnoticed: the policies read as though they exist to serve the
-- public staff directory on the marketing site. That page does need staff
-- data — but only names, subjects, photos and qualifications, and only for
-- teaching categories. It was selecting `*`, so the PII was travelling to
-- every visitor's browser as well as being available to direct API calls.
--
-- The fix separates the two needs:
--   1. The base tables become authenticated-only. Every ERP screen that reads
--      them from the browser is behind a login, so nothing in the admin app
--      changes. Nothing in the marketing site reads `teachers` at all.
--   2. A view, `public_staff_directory`, exposes ONLY the safe columns to
--      anon. It is the single public surface, so widening it is a deliberate
--      act rather than an accident of `select("*")`.
--
-- Deploy order does not matter. The directory component falls back to its
-- bundled static staff list whenever the query errors, so neither
-- "migration first" nor "code first" breaks the public page.
--
-- Every block below is guarded on the table actually existing. The first run
-- of this file aborted on `student_elective_picks` — created by migration 049,
-- which this database never received — and because the whole file is one
-- transaction, the staff-PII fix rolled back with it. A table that isn't there
-- has no policy to tighten and must not be able to block the part that
-- matters. The guards make the file safe to run against any deployment,
-- whatever subset of migrations it has seen.

begin;

-- ── teachers ────────────────────────────────────────────────────────────────
-- No public consumer exists; this table is read only by ERP screens (classes,
-- subjects, timetable, substitutions, staff) and by server routes.
do $$
begin
  if to_regclass('public.teachers') is null then
    raise notice 'skip: teachers does not exist';
    return;
  end if;
  drop policy if exists "Public can read teachers" on teachers;
  drop policy if exists "Authenticated can read teachers" on teachers;
  create policy "Authenticated can read teachers"
    on teachers for select
    to authenticated
    using (true);
end $$;

-- ── staff_members ───────────────────────────────────────────────────────────
do $$
begin
  if to_regclass('public.staff_members') is null then
    raise notice 'skip: staff_members does not exist';
    return;
  end if;
  drop policy if exists "Public can view staff members" on staff_members;
  drop policy if exists "Authenticated can read staff members" on staff_members;
  create policy "Authenticated can read staff members"
    on staff_members for select
    to authenticated
    using (true);
end $$;

-- ── public directory ────────────────────────────────────────────────────────
-- The view runs with its OWNER's rights, which is the default for every
-- Postgres version (the opt-in `security_invoker = true` is 15+, and naming
-- it explicitly as false broke this file on 14 — so it is simply omitted).
-- Owner rights are the point here: the view is not blocked by the
-- authenticated-only policy above, and it can only ever return the columns
-- named below. This IS the curated public projection.
--
-- The category filter is applied here as well as in the component: the public
-- directory lists teaching and management staff, never bus drivers or peons,
-- and that should not depend on a client-side filter being remembered.
do $$
begin
  if to_regclass('public.staff_members') is null then
    raise notice 'skip: public_staff_directory needs staff_members';
    return;
  end if;

  execute $v$
    create or replace view public_staff_directory as
      select id, name, subject, category, photo_url, qualifications, sort_order
      from staff_members
      where is_active = true
        and category in (
          'management', 'pgt', 'tgt', 'prt', 'motherTeachers', 'admin'
        )
  $v$;

  execute 'grant select on public_staff_directory to anon, authenticated';

  execute $c$
    comment on view public_staff_directory is
      'The only staff data readable without logging in. Columns are '
      'deliberately limited: staff_members also holds date_of_birth, address, '
      'phone, email and license_number, none of which may ever be added here. '
      'See migration 098.'
  $c$;
end $$;

-- ── student roster enumeration ──────────────────────────────────────────────
-- `student_subjects` and `student_elective_picks` are both keyed on
-- student_id and were also readable by anon. Joined against the (legitimately
-- public) classes and subjects tables, that hands an unauthenticated caller
-- the complete student UUID keyspace plus each student's stream and subject
-- choices — the input to every other student_id-parameterised probe.
--
-- Neither table has a single browser-side reader: every consumer is a server
-- route on the service-role client, which bypasses RLS entirely. Restricting
-- them to authenticated therefore changes no working behaviour.
do $$
declare
  t text;
begin
  foreach t in array array['student_subjects', 'student_elective_picks'] loop
    if to_regclass('public.' || t) is null then
      -- student_elective_picks comes from migration 049; a database that never
      -- received it simply has nothing to tighten here.
      raise notice 'skip: % does not exist', t;
      continue;
    end if;
    execute format('drop policy if exists %I on %I', 'Public can read ' || t, t);
    execute format('drop policy if exists %I on %I', 'Authenticated can read ' || t, t);
    execute format(
      'create policy %I on %I for select to authenticated using (true)',
      'Authenticated can read ' || t, t
    );
  end loop;
end $$;

commit;
