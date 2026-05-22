import { NextResponse } from "next/server";
import { getCallerAccess } from "@nkps/shared/lib/verify-admin";
import type { FeatureKey } from "@nkps/shared/lib/permissions";

// ERP-side dashboard counts. Privileged stats never appear in the response
// for an editor who lacks the grant, so nothing leaks into the DOM.
export async function GET() {
  const access = await getCallerAccess();
  if (!access) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { admin, isAdmin, permissions } = access;
  const can = (key: FeatureKey) => isAdmin || permissions.has(key);

  const today = new Date().toISOString().split("T")[0];

  const [studentsRes, staffRes, eventsRes, pendingRegsRes, profilesRes] =
    await Promise.all([
      can("students")
        ? admin
            .from("students")
            .select("*", { count: "exact", head: true })
            .eq("is_active", true)
        : Promise.resolve({ count: null }),
      can("staff")
        ? admin
            .from("staff_members")
            .select("*", { count: "exact", head: true })
            .eq("is_active", true)
        : Promise.resolve({ count: null }),
      can("calendar")
        ? admin
            .from("calendar_events")
            .select("id, title, description, event_type, start_date, end_date")
            .gte("start_date", today)
            .order("start_date", { ascending: true })
            .limit(8)
        : Promise.resolve({ data: [] }),
      isAdmin
        ? admin
            .from("registration_requests")
            .select("*", { count: "exact", head: true })
            .eq("status", "pending")
        : Promise.resolve({ count: null }),
      // Total users count is admin-only — even editors with broad access don't
      // need to see the user population.
      isAdmin
        ? admin.from("profiles").select("*", { count: "exact", head: true })
        : Promise.resolve({ count: null }),
    ]);

  const stats: Partial<
    Record<
      "totalUsers" | "totalStudents" | "totalStaff" | "pendingRegistrations",
      number
    >
  > = {};
  if (can("students")) stats.totalStudents = studentsRes.count ?? 0;
  if (can("staff")) stats.totalStaff = staffRes.count ?? 0;
  if (isAdmin) stats.pendingRegistrations = pendingRegsRes.count ?? 0;
  if (isAdmin) stats.totalUsers = profilesRes.count ?? 0;

  return NextResponse.json({
    stats,
    upcomingEvents: eventsRes.data ?? [],
    canSeeEvents: can("calendar"),
  });
}
