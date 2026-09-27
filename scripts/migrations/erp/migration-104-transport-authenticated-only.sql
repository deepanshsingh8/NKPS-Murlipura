-- migration-104-transport-authenticated-only.sql
--
-- SECURITY. Closes an unauthenticated read of the school's transport network.
--
-- ── What was exposed ────────────────────────────────────────────────────────
-- Four tables carried a policy of the form
--
--     CREATE POLICY "Public can read bus_stops" ON bus_stops
--       FOR SELECT USING (true);
--
-- A policy with no TO clause applies to PUBLIC, which includes the `anon`
-- role. The anon key is public by design — it ships inside the marketing
-- site's JavaScript bundle — so anyone on the internet could read:
--
--   bus_stops        188 rows: every pickup point, by name
--                    e.g. "34 No. Bus Stand, Niwaru Road"
--   bus_route_stops  which bus serves which stop, i.e. the route map
--   bus_stop_fees    the fee charged at each stop
--   buses            bus_number, registration_number ("RJ 14 PE 9496"),
--                    capacity, driver_id
--
-- Joined, those four answer: *which vehicle, with which number plate, collects
-- children at which of 188 locations.* For a school that is a child-safety
-- exposure, not merely a data leak. Verified by issuing real anon-key requests
-- against production — all four returned HTTP 200 with live rows.
--
-- ── Why `authenticated` is the right level ─────────────────────────────────
-- Nothing public consumes these. `apps/website/src` contains ZERO references
-- to any of the four (grepped). Every real reader is an authenticated ERP
-- surface:
--
--   parent/transport, student/fees          (parents and students)
--   (admin)/transport/{assignments,buses,drivers,changes}
--   api/{transport/assignments,fees/payments,export/students}
--
-- Server-side routes use the service-role client, which bypasses RLS entirely
-- and is unaffected either way.
--
-- Reads stay unrestricted WITHIN the authenticated set rather than scoped per
-- family. That is deliberate: the transport UI legitimately lists every stop
-- (the change-request picker, the assignment grid), so a self-only policy
-- would break those screens. This migration closes the anonymous hole and
-- changes nothing for a logged-in user.
--
-- ── Why DROP-by-name is safe here, unlike migration-102 ────────────────────
-- supabase-schema.sql is known to drift from the live policy set, which is why
-- migration-102 had to be a catalog transform. These four names were read
-- directly from `pg_policies` on the live database, so they are ground truth,
-- not mirror guesswork. The assertion at the bottom fails the migration if any
-- anonymous read survives, so a name that did NOT match cannot pass silently.
--
-- The companion write policies ("Admins write bus_stops", …) are left alone:
-- they gate on get_user_role() = 'admin', which is already false for anon.
-- ─────────────────────────────────────────────────────────────────────────

BEGIN;

-- ── bus_stops ───────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Public can read bus_stops" ON public.bus_stops;
CREATE POLICY "Authenticated can read bus_stops"
  ON public.bus_stops FOR SELECT
  TO authenticated
  USING (true);

-- ── bus_route_stops ─────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Public can read bus_route_stops" ON public.bus_route_stops;
CREATE POLICY "Authenticated can read bus_route_stops"
  ON public.bus_route_stops FOR SELECT
  TO authenticated
  USING (true);

-- ── bus_stop_fees ───────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Public can read bus_stop_fees" ON public.bus_stop_fees;
CREATE POLICY "Authenticated can read bus_stop_fees"
  ON public.bus_stop_fees FOR SELECT
  TO authenticated
  USING (true);

-- ── buses ───────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Public can read buses" ON public.buses;
CREATE POLICY "Authenticated can read buses"
  ON public.buses FOR SELECT
  TO authenticated
  USING (true);

-- ── Assertion: no anonymous read may survive on these four ─────────────────
-- Catches both a policy name that did not match the DROPs above and any future
-- policy that re-opens one of these tables to anon. Aborts the transaction.
DO $assert$
DECLARE leaked text;
BEGIN
  SELECT string_agg(format('%s."%s"', tablename, policyname), ', ')
    INTO leaked
    FROM pg_policies
   WHERE schemaname = 'public'
     AND tablename IN ('bus_stops','bus_route_stops','bus_stop_fees','buses')
     AND cmd IN ('SELECT','ALL')
     AND permissive = 'PERMISSIVE'
     -- roles containing public/anon means unauthenticated callers are included
     AND (roles::text[] && ARRAY['public','anon'])
     -- ...and the predicate does not itself exclude them
     AND coalesce(qual, 'true') = 'true';

  IF leaked IS NOT NULL THEN
    RAISE EXCEPTION
      'migration-104 aborted: these policies still allow anonymous reads of transport data: %',
      leaked;
  END IF;

  RAISE NOTICE 'migration-104: transport tables are no longer readable by anon.';
END
$assert$;

COMMIT;

-- ─────────────────────────────────────────────────────────────────────────
-- VERIFY AFTER APPLYING
--
-- 1. From a shell, with the ANON key — all four must return [] (not rows):
--      curl -s "$SUPABASE_URL/rest/v1/bus_stops?select=name&limit=2" \
--           -H "apikey: $ANON" -H "Authorization: Bearer $ANON"
--
-- 2. Confirm a logged-in parent still sees their transport page, and that
--    /admin/transport/assignments still lists stops and buses.
--
-- 3. The other eight tables granted SELECT to public with USING (true) were
--    reviewed and left alone deliberately:
--      disclosure_items / disclosure_documents / disclosure_board_results
--         — the CBSE mandatory public disclosure page requires them.
--      academic_years / classes / class_subjects / exam_types
--      / elective_slot_options
--         — structural, non-personal, and read by public-facing surfaces.
--    Revisit class_subjects if teacher-to-class assignment is ever considered
--    sensitive; it is the only one of those carrying a person-level FK.
-- ─────────────────────────────────────────────────────────────────────────
