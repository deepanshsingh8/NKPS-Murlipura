import { NextResponse } from "next/server";
import { verifyAdminOrEditor } from "@nkps/shared/lib/verify-admin";
import { fetchAllRows } from "@nkps/shared/lib/fetch-all-rows";

/**
 * How many students each bus carries, for /transport/buses.
 *
 * The fleet tables are world-readable and load on the client, but the riders
 * are `student_enrollments` rows — student data, behind RLS and behind the
 * `transport` grant. So the count comes from here, the same way
 * /api/transport/assignments reads the assignments themselves.
 *
 * Only the count crosses the wire, never the enrollments: the buses screen has
 * no business holding a student roster.
 *
 * Counted exactly as /transport/assignments counts it — `has_transport` with a
 * bus, whatever the enrollment's status. Two screens disagreeing about how
 * full a bus is would be worse than either rule on its own, and a student who
 * has left still holds their seat until somebody removes the assignment, which
 * is the point of the Remove action over there.
 */
export async function GET(request: Request) {
  try {
    const admin = await verifyAdminOrEditor("transport");
    if (!admin) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const requestedYearId = new URL(request.url).searchParams.get(
      "academic_year_id"
    );

    // Same active-year rule as the assignments route: prefer is_current, else
    // newest by name, so the two screens resolve to the same year.
    const { data: yearsData, error: yearsError } = await admin
      .from("academic_years")
      .select("id, name, is_current")
      .order("name", { ascending: false });

    if (yearsError) {
      console.error("Bus load: fetch years error:", yearsError);
      return NextResponse.json(
        { error: "Failed to load academic years" },
        { status: 500 }
      );
    }

    const years = yearsData ?? [];
    const year =
      (requestedYearId ? years.find((y) => y.id === requestedYearId) : null) ??
      years.find((y) => y.is_current) ??
      years[0] ??
      null;

    if (!year) return NextResponse.json({ year: null, loads: {} });

    // Paged. `.range(0, 9999)` did not clear PostgREST's 1000-row cap — a
    // Range header can only ask for less than the cap, never more — so a full
    // school's transport roll stopped at a thousand riders and every bus was
    // silently under-reported, which is how a full bus reads as having seats.
    // Ordered by id so the pages are disjoint.
    const { data, error, truncated } = await fetchAllRows<{
      bus_id: string | null;
    }>((from, to) =>
      admin
        .from("student_enrollments")
        .select("bus_id")
        .eq("academic_year_id", year.id)
        .eq("has_transport", true)
        .not("bus_id", "is", null)
        .order("id", { ascending: true })
        .range(from, to)
    );

    if (error || truncated) {
      console.error(
        "Bus load: fetch enrollments error:",
        error ?? "read stopped at the paging guard"
      );
      return NextResponse.json(
        { error: "Failed to load bus occupancy" },
        { status: 500 }
      );
    }

    const loads: Record<string, number> = {};
    for (const row of data) {
      const busId = row.bus_id;
      if (busId) loads[busId] = (loads[busId] ?? 0) + 1;
    }

    return NextResponse.json({ year, loads });
  } catch (err) {
    console.error("Bus load fetch error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
