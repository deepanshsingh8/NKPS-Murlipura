import type { SupabaseClient } from "@supabase/supabase-js";
import type { TransportChangeRequest } from "@nkps/shared/types";

// A change is "permanent" when it has no end date — it becomes the new
// baseline on the enrollment. A dated window is a temporary overlay that we
// never write to the baseline (avoids a revert cron); readers overlay it while
// today ∈ [effective_from, effective_to].
export function isPermanentChange(change: {
  effective_to?: string | null;
}): boolean {
  return !change.effective_to;
}

// Apply an APPROVED change to the enrollment baseline. Temporary bus/stop
// changes are intentionally NOT written to the baseline (they surface as an
// overlay); drop/resume always take effect. Returns { error } on failure.
export async function applyTransportChange(
  admin: SupabaseClient,
  change: {
    enrollment_id: string;
    change_type: string;
    amended_bus_id?: string | null;
    amended_stop_id?: string | null;
    direction?: string | null;
    effective_to?: string | null;
  }
): Promise<{ applied: boolean; error?: string }> {
  const permanent = isPermanentChange(change);
  const patch: Record<string, unknown> = {};

  switch (change.change_type) {
    case "drop":
      patch.has_transport = false;
      break;
    case "resume":
      patch.has_transport = true;
      if (change.amended_stop_id) patch.bus_stop_id = change.amended_stop_id;
      break;
    case "bus_change":
      if (permanent && change.amended_bus_id) patch.bus_id = change.amended_bus_id;
      break;
    case "stop_change":
      if (permanent && change.amended_stop_id)
        patch.bus_stop_id = change.amended_stop_id;
      break;
    case "direction_change":
      if (change.direction) patch.transport_direction = change.direction;
      break;
  }

  if (Object.keys(patch).length === 0) return { applied: false };

  const { error } = await admin
    .from("student_enrollments")
    .update(patch)
    .eq("id", change.enrollment_id);

  if (error) return { applied: false, error: error.message };
  return { applied: true };
}

// The effective bus/stop for an enrollment today = an active, approved
// temporary amendment within its window, else the enrollment baseline.
export function effectiveTransport(
  baseline: { bus_id: string | null; bus_stop_id: string | null },
  changes: Pick<
    TransportChangeRequest,
    | "change_type"
    | "amended_bus_id"
    | "amended_stop_id"
    | "effective_from"
    | "effective_to"
    | "status"
  >[],
  today: string
): { bus_id: string | null; bus_stop_id: string | null } {
  let busId = baseline.bus_id;
  let stopId = baseline.bus_stop_id;
  for (const c of changes) {
    if (c.status !== "approved") continue;
    if (!c.effective_to) continue; // permanent changes already in baseline
    if (c.effective_from > today || c.effective_to < today) continue;
    if (c.change_type === "bus_change" && c.amended_bus_id)
      busId = c.amended_bus_id;
    if (c.change_type === "stop_change" && c.amended_stop_id)
      stopId = c.amended_stop_id;
  }
  return { bus_id: busId, bus_stop_id: stopId };
}
