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
