import { NextResponse } from "next/server";
import { verifyAdmin } from "@nkps/shared/lib/verify-admin";
import {
  ensureParentRecord,
  linkProfileToParent,
} from "@/lib/identity/link";

// Admin-only reconciliation surface for cross-role linking anomalies.
// Reads the profile_link_health view (migration 068). The "parent↔ward didn't
// work" class of failure used to be invisible until a human hit it — this makes
// it observable and (for the safe cases) one-click fixable.

const ERROR_CATEGORIES = new Set([
  "orphaned_profile",
  "role_link_mismatch",
  "duplicate_teacher_claim",
  "duplicate_student_claim",
  "duplicate_parent_claim",
]);

interface HealthRow {
  category: string;
  subject_id: string;
  subject_label: string | null;
  detail: string;
}

// GET /api/admin/link-health → grouped anomalies + counts.
export async function GET() {
  const admin = await verifyAdmin();
  if (!admin) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data, error } = await admin
    .from("profile_link_health")
    .select("category, subject_id, subject_label, detail");
  if (error) {
    console.error("[link-health] read view:", error);
    return NextResponse.json(
      { error: "Failed to load link health" },
      { status: 500 }
    );
  }

  const rows = (data ?? []) as HealthRow[];
  const groups: Record<string, HealthRow[]> = {};
  for (const row of rows) {
    (groups[row.category] ??= []).push(row);
  }

  const errorCount = rows.filter((r) => ERROR_CATEGORIES.has(r.category)).length;
  const infoCount = rows.length - errorCount;

  return NextResponse.json({
    total: rows.length,
    errorCount,
    infoCount,
    groups,
  });
}

// POST /api/admin/link-health → safe one-click auto-fixes:
//   (a) role_link_mismatch — a link is set but `role` is wrong (the signature
//       of the pre-fix bug: parent/teacher accounts left as role='student').
//       Derive the correct role from whichever link is set and align it.
//   (b) orphaned_profile, role='parent' with no parent_id — provision the
//       parents record and link it via the canonical service.
// Duplicate claims still need a human decision and are NOT auto-fixed here.
export async function POST(request: Request) {
  const admin = await verifyAdmin();
  if (!admin) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { profile_id } = await request.json();
  if (!profile_id) {
    return NextResponse.json({ error: "profile_id is required" }, { status: 400 });
  }

  const { data: profile } = await admin
    .from("profiles")
    .select("id, role, full_name, email, phone, teacher_id, student_id, parent_id")
    .eq("id", profile_id)
    .maybeSingle();
  if (!profile) {
    return NextResponse.json({ error: "Account not found" }, { status: 404 });
  }

  // (a) A link is set but the role doesn't match → align the role to the link.
  if (profile.parent_id && profile.role !== "parent") {
    return alignRole(admin, profile_id, "parent");
  }
  if (profile.teacher_id && profile.role !== "teacher" && profile.role !== "admin") {
    return alignRole(admin, profile_id, "teacher");
  }
  if (profile.student_id && profile.role !== "student") {
    return alignRole(admin, profile_id, "student");
  }

  // (b) role='parent' with no parent_id → provision + link.
  if (profile.role === "parent" && !profile.parent_id) {
    const parent = await ensureParentRecord(admin, {
      email: profile.email,
      fullName: profile.full_name,
      phone: profile.phone,
    });
    if ("error" in parent) {
      return NextResponse.json({ error: parent.error }, { status: parent.status });
    }
    const linked = await linkProfileToParent(admin, profile_id, parent.parentId);
    if (!linked.ok) {
      return NextResponse.json({ error: linked.error }, { status: linked.status });
    }
    return NextResponse.json({
      success: true,
      note: "Parent record provisioned and linked. Use the Link tool to connect a child.",
    });
  }

  return NextResponse.json(
    { error: "This anomaly needs a manual decision and can't be auto-fixed." },
    { status: 400 }
  );
}

async function alignRole(
  admin: ReturnType<typeof import("@nkps/shared/lib/supabase/admin").createAdminClient>,
  profileId: string,
  role: "parent" | "teacher" | "student"
) {
  // Clear the links the target role may not hold, then set the role — one
  // update so the enforce_profile_role_link trigger stays satisfied.
  const patch: Record<string, unknown> = { role, updated_at: new Date().toISOString() };
  if (role !== "teacher") patch.teacher_id = null;
  if (role !== "student") patch.student_id = null;
  if (role !== "parent") patch.parent_id = null;
  const { error } = await admin.from("profiles").update(patch).eq("id", profileId);
  if (error) {
    console.error("[link-health] alignRole:", error);
    return NextResponse.json({ error: "Failed to align the account role." }, { status: 500 });
  }
  return NextResponse.json({ success: true, note: `Role set to ${role} to match the linked record.` });
}
