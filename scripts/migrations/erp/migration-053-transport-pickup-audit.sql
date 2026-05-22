-- migration-053-transport-pickup-audit.sql
--
-- Adds the columns needed to (1) anchor each transport-using student to a
-- real geocoded pickup address, (2) record what the auto-pick suggested vs.
-- what the admin actually assigned, and (3) capture conductor-verified
-- coordinates the first time the bus actually picks the student up.
--
-- Why these live on student_enrollments and not a separate table:
--   - We already join student_enrollments for every fee/transport flow.
--     Adding a side-table would force every read path to join twice.
--   - The columns are 1:1 with an enrollment (transport is per-enrollment,
--     not per-student-year), so a side-table buys nothing.
--   - We're not building a full audit history of overrides — the *current*
--     suggested+assigned slabs + override metadata is enough signal for the
--     suspicious-assignment digest. If we ever need history, a dedicated
--     log table can be layered on without breaking these columns.
--
-- Idempotent.

ALTER TABLE student_enrollments
  ADD COLUMN IF NOT EXISTS pickup_address text,
  ADD COLUMN IF NOT EXISTS pickup_lat numeric(10, 7),
  ADD COLUMN IF NOT EXISTS pickup_lng numeric(10, 7),
  ADD COLUMN IF NOT EXISTS pickup_verified_at timestamptz,
  ADD COLUMN IF NOT EXISTS pickup_verified_by uuid
    REFERENCES profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS pickup_verified_lat numeric(10, 7),
  ADD COLUMN IF NOT EXISTS pickup_verified_lng numeric(10, 7),
  ADD COLUMN IF NOT EXISTS transport_slab_suggested_id uuid
    REFERENCES transport_fare_slabs(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS transport_slab_overridden_at timestamptz,
  ADD COLUMN IF NOT EXISTS transport_slab_overridden_by uuid
    REFERENCES profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS transport_slab_override_reason text;

-- Coordinates are always paired — both columns must be set together or
-- neither. The address may exist without coordinates (geocoding failed) so
-- it isn't covered by this check.
ALTER TABLE student_enrollments
  DROP CONSTRAINT IF EXISTS chk_pickup_coords_paired;
ALTER TABLE student_enrollments
  ADD CONSTRAINT chk_pickup_coords_paired CHECK (
    (pickup_lat IS NULL AND pickup_lng IS NULL)
    OR (pickup_lat IS NOT NULL AND pickup_lng IS NOT NULL)
  );

ALTER TABLE student_enrollments
  DROP CONSTRAINT IF EXISTS chk_pickup_verified_coords_paired;
ALTER TABLE student_enrollments
  ADD CONSTRAINT chk_pickup_verified_coords_paired CHECK (
    (pickup_verified_lat IS NULL AND pickup_verified_lng IS NULL)
    OR (pickup_verified_lat IS NOT NULL AND pickup_verified_lng IS NOT NULL)
  );

-- An override is only meaningful when a suggestion existed AND the
-- assigned slab differs from it. We don't enforce that as a CHECK (it
-- would block the migration on existing rows that have transport_slab_id
-- set but no suggestion yet), but we *do* require the reason whenever the
-- override timestamp is set — that's the audit promise.
ALTER TABLE student_enrollments
  DROP CONSTRAINT IF EXISTS chk_override_reason_required;
ALTER TABLE student_enrollments
  ADD CONSTRAINT chk_override_reason_required CHECK (
    transport_slab_overridden_at IS NULL
    OR (transport_slab_override_reason IS NOT NULL
        AND length(btrim(transport_slab_override_reason)) >= 3)
  );

-- Indexes targeting the dashboard digest queries:
--   * Unverified rides (NULL pickup_verified_at) older than N days.
--   * Overrides — usually the admin wants to see only overridden rows.
CREATE INDEX IF NOT EXISTS idx_enrollments_pickup_unverified
  ON student_enrollments(has_transport, pickup_verified_at)
  WHERE has_transport = true AND pickup_verified_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_enrollments_slab_overridden
  ON student_enrollments(transport_slab_overridden_at)
  WHERE transport_slab_overridden_at IS NOT NULL;

COMMENT ON COLUMN student_enrollments.pickup_address IS
  'Free-text home/pickup address the parent supplied. Source of truth for billing distance.';
COMMENT ON COLUMN student_enrollments.pickup_lat IS
  'Geocoded latitude of pickup_address. Used to derive transport slab via haversine from school.';
COMMENT ON COLUMN student_enrollments.pickup_verified_at IS
  'Conductor/admin attestation that the bus actually picks the student up at the claimed coordinates.';
COMMENT ON COLUMN student_enrollments.transport_slab_suggested_id IS
  'Slab the auto-picker recommended based on pickup_lat/lng. Null when no address has been geocoded yet.';
COMMENT ON COLUMN student_enrollments.transport_slab_overridden_at IS
  'Set whenever transport_slab_id differs from transport_slab_suggested_id. Override requires a reason.';
