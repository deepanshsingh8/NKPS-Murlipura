import { NextRequest, NextResponse } from "next/server";
import { verifyAdminOrEditorWithUser } from "@nkps/shared/lib/verify-admin";
import { z } from "zod";

// POST /api/students/transport/verify
//
// Records the attestation that the bus actually picks the student up at
// the claimed coordinates. The conductor/admin presses this after the
// first physical pickup; the timestamp + the actor's profile id become the
// audit trail. Optional verified_lat/verified_lng captures the GPS reading
// when one is available (browser geolocation on a phone), used by the
// dashboard digest to flag mismatch with the claimed pickup_lat/lng.
//
// `verified=false` resets the attestation — useful when the parent moves
// or the address changes and the admin wants the student back in the
// "unverified" bucket for a re-check.

const bodySchema = z.object({
  enrollment_id: z.string().uuid(),
  verified: z.boolean(),
  verified_lat: z.number().min(-90).max(90).nullable().optional(),
  verified_lng: z.number().min(-180).max(180).nullable().optional(),
});

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

  // Coordinate pairing matches the schema CHECK constraint.
  const hasLat = body.verified_lat != null;
  const hasLng = body.verified_lng != null;
  if (hasLat !== hasLng) {
    return NextResponse.json(
      { error: "verified_lat and verified_lng must be set together" },
      { status: 400 }
    );
  }

  const update: Record<string, unknown> = body.verified
    ? {
        pickup_verified_at: new Date().toISOString(),
        pickup_verified_by: user.id,
        pickup_verified_lat: body.verified_lat ?? null,
        pickup_verified_lng: body.verified_lng ?? null,
      }
    : {
        pickup_verified_at: null,
        pickup_verified_by: null,
        pickup_verified_lat: null,
        pickup_verified_lng: null,
      };

  const { error } = await admin
    .from("student_enrollments")
    .update(update)
    .eq("id", body.enrollment_id);

  if (error) {
    console.error("[transport.verify] update:", error);
    return NextResponse.json(
      { error: "Failed to update verification" },
      { status: 500 }
    );
  }
  return NextResponse.json({ success: true });
}
