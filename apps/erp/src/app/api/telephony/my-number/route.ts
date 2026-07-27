import { NextRequest, NextResponse } from "next/server";
import { verifyAdminOrEditorWithUser } from "@nkps/shared/lib/verify-admin";
import { normalizeIndianMobile } from "@nkps/shared/lib/telephony/exotel";

// The staff member's own phone (Exotel rings this leg first) is stored on
// profiles.phone. These endpoints let a caller read and set THEIR OWN number —
// the update is always scoped to user.id, so it can't touch anyone else's row
// and only ever writes the `phone` column (never role/access).

export async function GET() {
  const gate = await verifyAdminOrEditorWithUser("students");
  if (!gate) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { admin, user } = gate;

  const { data } = await admin
    .from("profiles")
    .select("phone")
    .eq("id", user.id)
    .maybeSingle();

  const phone = data?.phone ?? null;
  return NextResponse.json({ phone, valid: normalizeIndianMobile(phone) !== null });
}

export async function PATCH(request: NextRequest) {
  const gate = await verifyAdminOrEditorWithUser("students");
  if (!gate) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { admin, user } = gate;

  const body = await request.json().catch(() => ({}));
  const normalized = normalizeIndianMobile(typeof body.phone === "string" ? body.phone : "");
  if (!normalized) {
    return NextResponse.json(
      { error: "Enter a valid 10-digit Indian mobile number." },
      { status: 400 }
    );
  }

  // Store the digits (without +91) to match how numbers are entered elsewhere
  // in the app; normalization re-applies +91 at call time.
  const digits = normalized.slice(3);
  const { error } = await admin
    .from("profiles")
    .update({ phone: digits, updated_at: new Date().toISOString() })
    .eq("id", user.id);
  if (error) {
    console.error("my-number update error:", error);
    return NextResponse.json({ error: "Failed to save number." }, { status: 500 });
  }

  return NextResponse.json({ ok: true, phone: digits });
}
