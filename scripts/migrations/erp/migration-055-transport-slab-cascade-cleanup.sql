-- migration-055-transport-slab-cascade-cleanup.sql
--
-- When a transport fare slab is deleted OR deactivated, every student
-- currently assigned to it must be opted out of transport. Without this:
--
--   * DELETE fails outright — the FK on student_enrollments.transport_slab_id
--     is ON DELETE SET NULL, but the check constraint
--     `has_transport = false OR transport_slab_id IS NOT NULL` then trips
--     because has_transport is still true with a null slab.
--   * Deactivation silently leaves students billed against an inactive slab.
--     They keep paying transport fees the school no longer offers at that
--     rate, and dues reports still show the slab as their fare basis.
--
-- The trigger clears the assignment server-side so the cleanup happens
-- atomically with the slab change, regardless of who triggers it (admin
-- UI, future bulk-import job, manual psql session). Audit columns
-- (transport_slab_suggested_id / override_*) are wiped at the same time
-- because they're now meaningless without an assigned slab.
--
-- Idempotent.

CREATE OR REPLACE FUNCTION trg_clear_transport_on_slab_change()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    -- Run BEFORE the FK's ON DELETE SET NULL fires so the rows are already
    -- has_transport=false by the time the FK rewrites transport_slab_id.
    -- (If the FK fired first, the check constraint would explode.)
    UPDATE student_enrollments
      SET has_transport = false,
          transport_slab_id = NULL,
          transport_slab_suggested_id = NULL,
          transport_slab_overridden_at = NULL,
          transport_slab_overridden_by = NULL,
          transport_slab_override_reason = NULL,
          updated_at = now()
    WHERE transport_slab_id = OLD.id;
    RETURN OLD;
  END IF;

  -- UPDATE path: only act when the slab flips from active to inactive.
  -- Re-activating a slab does NOT auto-re-enrol students — that's a
  -- conscious admin re-assignment, not a side-effect of toggling the flag.
  IF TG_OP = 'UPDATE'
     AND OLD.is_active = true
     AND NEW.is_active = false THEN
    UPDATE student_enrollments
      SET has_transport = false,
          transport_slab_id = NULL,
          transport_slab_suggested_id = NULL,
          transport_slab_overridden_at = NULL,
          transport_slab_overridden_by = NULL,
          transport_slab_override_reason = NULL,
          updated_at = now()
    WHERE transport_slab_id = NEW.id;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS slab_before_delete_clear_enrollments ON transport_fare_slabs;
CREATE TRIGGER slab_before_delete_clear_enrollments
  BEFORE DELETE ON transport_fare_slabs
  FOR EACH ROW
  EXECUTE FUNCTION trg_clear_transport_on_slab_change();

DROP TRIGGER IF EXISTS slab_after_deactivate_clear_enrollments ON transport_fare_slabs;
CREATE TRIGGER slab_after_deactivate_clear_enrollments
  AFTER UPDATE OF is_active ON transport_fare_slabs
  FOR EACH ROW
  WHEN (OLD.is_active IS DISTINCT FROM NEW.is_active)
  EXECUTE FUNCTION trg_clear_transport_on_slab_change();

-- Helper RPC the admin UI calls before showing the delete confirm dialog,
-- so the admin sees "this will opt out N students" before clicking through.
-- Returns the count of active enrollments currently pointing at this slab.
CREATE OR REPLACE FUNCTION count_transport_slab_dependents(p_slab_id uuid)
RETURNS integer
LANGUAGE sql
STABLE
AS $$
  SELECT COUNT(*)::integer
    FROM student_enrollments
   WHERE transport_slab_id = p_slab_id
     AND has_transport = true;
$$;
