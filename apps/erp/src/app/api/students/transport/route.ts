import { NextRequest, NextResponse } from "next/server";
import { verifyAdminOrEditorWithUser } from "@nkps/shared/lib/verify-admin";
import { z } from "zod";

// POST /api/students/transport
//
// Single source of truth for assigning transport to a student. Replaces the
// old direct adminApi("update", "student_enrollments", …) call so the
// override-audit rules can be enforced server-side instead of trusting the
// client to fill them in.
//
// Why this lives in its own route and not on /api/students:
//   - The override-vs-suggested check requires reading the slab catalog,
//     which the students PATCH route shouldn't have to know about.
//   - The body shape is different enough (pickup coords, reason) that
//     overloading PATCH would obscure the audit contract.

const SCHOOL = { lat: 27.0688458, lng: 75.7495752 };

const bodySchema = z.object({
  enrollment_id: z.string().uuid(),
  has_transport: z.boolean(),
  // Pickup address is optional — schools may opt in to transport before
  // collecting a full address (the student starts on the bus today but
  // the parent will WhatsApp the address tomorrow). When provided, we
  // require both coordinates so the haversine math has something to chew.
  pickup_address: z.string().trim().nullable().optional(),
  pickup_lat: z.number().min(-90).max(90).nullable().optional(),
  pickup_lng: z.number().min(-180).max(180).nullable().optional(),
  // Slab is required when has_transport=true.
  slab_id: z.string().uuid().nullable().optional(),
  // Required iff the admin picks a slab that differs from what auto-pick
  // would suggest given pickup_lat/lng. Trimmed and lower-bounded so the
  // audit isn't "asdf".
  override_reason: z.string().trim().min(3).nullable().optional(),
});

function haversineKm(aLat: number, aLng: number, bLat: number, bLng: number) {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const lat1 = toRad(aLat);
  const lat2 = toRad(bLat);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.sin(dLng / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
  return 2 * R * Math.asin(Math.sqrt(a));
}

export async function POST(request: NextRequest) {
  const access = await verifyAdminOrEditorWithUser("fees");
  if (!access) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { admin, user } = access;

  const parsed = bodySchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid data", details: parsed.error.flatten() },
      { status: 400 }
    );
  }
  const body = parsed.data;

  // Look up the enrollment so we can resolve its academic year (slabs are
  // year-scoped) and detect changes from the previous override state.
  const { data: enrollment, error: enrollmentErr } = await admin
    .from("student_enrollments")
    .select(
      "id, academic_year_id, transport_slab_id, transport_slab_suggested_id, transport_slab_overridden_at, pickup_address, pickup_lat, pickup_lng"
    )
    .eq("id", body.enrollment_id)
    .maybeSingle();

  if (enrollmentErr || !enrollment) {
    return NextResponse.json(
      { error: "Enrollment not found" },
      { status: 404 }
    );
  }

  // Opt-out path: clear the slab + override metadata but keep pickup
  // coords (parents who flip back later shouldn't have to re-enter).
  if (!body.has_transport) {
    const { error } = await admin
      .from("student_enrollments")
      .update({
        has_transport: false,
        transport_slab_id: null,
        transport_slab_suggested_id: null,
        transport_slab_overridden_at: null,
        transport_slab_overridden_by: null,
        transport_slab_override_reason: null,
        // pickup_address / pickup_lat / pickup_lng intentionally retained.
      })
      .eq("id", body.enrollment_id);
    if (error) {
      console.error("[transport.POST] opt-out:", error);
      return NextResponse.json(
        { error: "Failed to opt out of transport" },
        { status: 500 }
      );
    }
    return NextResponse.json({ success: true });
  }

  // Opt-in path: slab is required and the override-vs-suggested check runs.
  if (!body.slab_id) {
    return NextResponse.json(
      { error: "Pick a slab before opting in to transport" },
      { status: 400 }
    );
  }

  // Coordinate pairing: schema check_constraint enforces this too, but
  // returning a friendly error beats a Postgres-level 23514.
  const hasLat = body.pickup_lat != null;
  const hasLng = body.pickup_lng != null;
  if (hasLat !== hasLng) {
    return NextResponse.json(
      { error: "pickup_lat and pickup_lng must be set together" },
      { status: 400 }
    );
  }

  // Verify the slab exists, is active, and belongs to this enrollment's
  // academic year. Stops admins from accidentally assigning a slab from a
  // different year (which would slip past the foreign-key check).
  const { data: chosenSlab, error: slabErr } = await admin
    .from("transport_fare_slabs")
    .select("id, academic_year_id, is_active, distance_km_min, distance_km_max")
    .eq("id", body.slab_id)
    .maybeSingle();
  if (slabErr || !chosenSlab) {
    return NextResponse.json({ error: "Slab not found" }, { status: 404 });
  }
  if (!chosenSlab.is_active) {
    return NextResponse.json({ error: "Slab is inactive" }, { status: 400 });
  }
  if (chosenSlab.academic_year_id !== enrollment.academic_year_id) {
    return NextResponse.json(
      { error: "Slab belongs to a different academic year" },
      { status: 400 }
    );
  }

  // Compute the suggested slab from the pickup coords (when known). When
  // no coords are supplied, the assignment can't be audited as override —
  // we still allow the save but record null as the suggested id.
  let suggestedId: string | null = null;
  if (hasLat && hasLng) {
    const distanceKm = haversineKm(
      SCHOOL.lat,
      SCHOOL.lng,
      body.pickup_lat as number,
      body.pickup_lng as number
    );

    const { data: slabs } = await admin
      .from("transport_fare_slabs")
      .select("id, distance_km_min, distance_km_max, is_active, sort_order")
      .eq("academic_year_id", enrollment.academic_year_id)
      .eq("is_active", true)
      .order("distance_km_min", { ascending: true, nullsFirst: true });

    for (const s of (slabs ?? []) as {
      id: string;
      distance_km_min: number | null;
      distance_km_max: number | null;
    }[]) {
      const min = s.distance_km_min == null ? 0 : Number(s.distance_km_min);
      const max =
        s.distance_km_max == null
          ? Number.POSITIVE_INFINITY
          : Number(s.distance_km_max);
      if (distanceKm >= min && distanceKm <= max) {
        suggestedId = s.id;
        break;
      }
    }
  }

  const isOverride = suggestedId != null && suggestedId !== body.slab_id;
  if (isOverride && !body.override_reason) {
    return NextResponse.json(
      {
        error:
          "This slab differs from the suggested slab — a reason is required to override.",
      },
      { status: 400 }
    );
  }

  const now = new Date().toISOString();
  const update: Record<string, unknown> = {
    has_transport: true,
    transport_slab_id: body.slab_id,
    transport_slab_suggested_id: suggestedId,
    pickup_address: body.pickup_address ?? null,
    pickup_lat: body.pickup_lat ?? null,
    pickup_lng: body.pickup_lng ?? null,
  };
  if (isOverride) {
    update.transport_slab_overridden_at = now;
    update.transport_slab_overridden_by = user.id;
    update.transport_slab_override_reason = body.override_reason;
  } else {
    update.transport_slab_overridden_at = null;
    update.transport_slab_overridden_by = null;
    update.transport_slab_override_reason = null;
  }

  // If the pickup coords changed, drop the previous verification —
  // a verified pickup at the old coords doesn't vouch for the new ones.
  const coordsChanged =
    enrollment.pickup_lat?.toString() !== (body.pickup_lat ?? null)?.toString() ||
    enrollment.pickup_lng?.toString() !== (body.pickup_lng ?? null)?.toString();
  if (coordsChanged) {
    update.pickup_verified_at = null;
    update.pickup_verified_by = null;
    update.pickup_verified_lat = null;
    update.pickup_verified_lng = null;
  }

  const { error } = await admin
    .from("student_enrollments")
    .update(update)
    .eq("id", body.enrollment_id);

  if (error) {
    console.error("[transport.POST] update:", error);
    return NextResponse.json(
      { error: "Failed to save transport assignment" },
      { status: 500 }
    );
  }

  return NextResponse.json({
    success: true,
    suggested_slab_id: suggestedId,
    is_override: isOverride,
  });
}
