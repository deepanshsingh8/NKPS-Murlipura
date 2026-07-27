import { NextResponse } from "next/server";
import { verifyAdminWithUser } from "@nkps/shared/lib/verify-admin";
import { createPortalUser } from "@nkps/shared/lib/create-portal-user";
import { rateLimit } from "@nkps/shared/lib/rate-limit";
import { promoteStaffToTeacher } from "@/lib/staff-teacher-sync";
import { staffPortalRole } from "@nkps/shared/lib/staff-roles";

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

  // For staff, the login role depends on category (teaching → teacher, office →
  // staff, drivers/peons → no login). Fetch categories once so the per-item
  // loop can branch without an extra round-trip each.
  const staffCategoryById = new Map<string, string>();
  if (type === "staff") {
    const { data: rows } = await admin
      .from("staff_members")
      .select("id, category")
      .in("id", items.map((i) => i.id));
    for (const r of rows ?? []) {
      staffCategoryById.set(r.id as string, r.category as string);
    }
  }

  for (const item of items) {
    if (!item.email) {
      results.push({ id: item.id, name: item.fullName, success: false, error: "No email address" });
      failed++;
      continue;
    }

    // Resolve the role this login should get.
    let role: "student" | "teacher" | "staff";
    if (type === "student") {
      role = "student";
    } else {
      const portalRole = staffPortalRole(staffCategoryById.get(item.id) ?? "");
      if (portalRole === null) {
        // Bus drivers / peons don't get a login — report and skip.
        results.push({
          id: item.id,
          name: item.fullName,
          success: false,
          error: "This staff category does not get a portal login.",
        });
        failed++;
        continue;
      }
      role = portalRole;
    }

    // A teacher login needs a real `teachers.id` for the profile FK. `item.id`
    // is a `staff_members.id`, so resolve (creating if needed) the linked
    // teachers row and use ITS id. Idempotent — reuses an existing record.
    // Office staff ('staff' role) carry no domain link, so skip this.
    let teacherId: string | undefined;
    if (role === "teacher") {
      const promo = await promoteStaffToTeacher(admin, item.id);
      if ("error" in promo) {
        results.push({
          id: item.id,
          name: item.fullName,
          success: false,
          error: promo.error,
        });
        failed++;
        continue;
      }
      teacherId = promo.teacher_id;
    }

    const userResult = await createPortalUser({
      email: item.email,
      fullName: item.fullName,
      role,
      phone: item.phone || null,
      studentId: type === "student" ? item.id : undefined,
      teacherId,
    });

    if (userResult.success && userResult.userId) {
      // createPortalUser already set role + the link (student_id / teacher_id)
      // in one update; no second write needed. (Phase 1 — canonical linking.)
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
