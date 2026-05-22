import { NextResponse } from "next/server";
import { verifyAdminWithUser } from "@nkps/shared/lib/verify-admin";
import { createPortalUser } from "@nkps/shared/lib/create-portal-user";
import { rateLimit } from "@nkps/shared/lib/rate-limit";

export const maxDuration = 120;

// M3 — defense-in-depth caps. The route is admin-only, but a compromised
// admin token can otherwise weaponize this into mass user creation +
// welcome-email spam. 200 covers a class roster; 5 calls/hr is enough for
// onboarding waves with retries.
const MAX_ITEMS_PER_CALL = 200;

interface BulkItem {
  id: string;
  email: string;
  fullName: string;
  phone?: string | null;
}

export async function POST(request: Request) {
  const auth = await verifyAdminWithUser();
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { admin, user } = auth;

  const limit = rateLimit({
    name: "portal-bulk-create",
    key: user.id,
    max: 5,
    windowSeconds: 3600,
  });
  if (!limit.ok) {
    return NextResponse.json(
      {
        error: `Bulk-create rate limit hit. Try again in ${Math.ceil(
          limit.resetSeconds / 60
        )} minute(s).`,
      },
      { status: 429 }
    );
  }

  const body = await request.json();
  const { type, items } = body as {
    type: "student" | "staff";
    items: BulkItem[];
  };

  if (!type || !["student", "staff"].includes(type)) {
    return NextResponse.json({ error: "Invalid type" }, { status: 400 });
  }
  if (!Array.isArray(items) || items.length === 0) {
    return NextResponse.json({ error: "No items provided" }, { status: 400 });
  }
  if (items.length > MAX_ITEMS_PER_CALL) {
    return NextResponse.json(
      { error: `Too many items in one call. Max ${MAX_ITEMS_PER_CALL}.` },
      { status: 400 }
    );
  }

  const results: { id: string; name: string; success: boolean; error?: string }[] = [];
  let created = 0;
  let failed = 0;

  for (const item of items) {
    if (!item.email) {
      results.push({ id: item.id, name: item.fullName, success: false, error: "No email address" });
      failed++;
      continue;
    }

    const role = type === "student" ? "student" : "teacher";
    const userResult = await createPortalUser({
      email: item.email,
      fullName: item.fullName,
      role,
      phone: item.phone || null,
      studentId: type === "student" ? item.id : undefined,
      teacherId: type === "staff" ? item.id : undefined,
    });

    if (userResult.success && userResult.userId) {
      // Link the profile to the student/staff record
      if (type === "student") {
        await admin
          .from("profiles")
          .update({ student_id: item.id })
          .eq("id", userResult.userId);
      } else {
        await admin
          .from("profiles")
          .update({ teacher_id: item.id })
          .eq("id", userResult.userId);
      }
      results.push({ id: item.id, name: item.fullName, success: true });
      created++;
    } else {
      results.push({
        id: item.id,
        name: item.fullName,
        success: false,
        error: userResult.error || "Unknown error",
      });
      failed++;
    }
  }

  return NextResponse.json({
    results,
    created,
    failed,
    total: items.length,
  });
}
