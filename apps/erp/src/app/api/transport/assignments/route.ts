import { NextResponse } from "next/server";
import { verifyAdminOrEditor } from "@nkps/shared/lib/verify-admin";

/**
 * Year-scoped data for /transport/assignments.
 *
 * Why this route exists at all: the page used to read `student_enrollments`
 * (with an embedded `students`) straight from the browser client, which runs
 * under RLS. Office staff hold role='staff', and the student-data SELECT
 * policies were still written against the 'editor' role that migration 047
 * deleted — so the query returned zero rows with no error and the screen said
 * "No enrollments found for the active academic year", regardless of which
 * features the admin had granted.
 *
 * Migration 084 repairs those policies, but reading student data through a
 * service-role route is the pattern the rest of the app already uses
 * (/api/students does exactly this), and it makes access depend on the
 * transport grant this route checks rather than on a role-coarse RLS policy.
 *
 * Only year-scoped tables live here. bus_stops / buses / bus_route_stops are
 * world-readable by policy and stay on the client, where they load in parallel
 * with this request.
 */
export async function GET() {
  try {
    const admin = await verifyAdminOrEditor("transport");
    if (!admin) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Active year: prefer is_current, else newest by name — same rule the page
    // applied client-side, kept here so the fallback survives a year switch
    // where no row carries the flag.
    const { data: yearsData, error: yearsError } = await admin
      .from("academic_years")
      .select("*")
      .order("name", { ascending: false });

    if (yearsError) {
      console.error("Transport assignments: fetch years error:", yearsError);
      return NextResponse.json(
        { error: "Failed to load academic years" },
        { status: 500 }
      );
    }

    const years = yearsData ?? [];
    const year = years.find((y) => y.is_current) ?? years[0] ?? null;

    if (!year) {
      return NextResponse.json({ year: null, enrollments: [], fees: [] });
    }

    // .range(0, 9999) pushes past PostgREST's 1000-row default cap — a full
    // school's enrollments exceed it, and the truncation would be silent.
    const [enrollRes, feesRes] = await Promise.all([
      admin
        .from("student_enrollments")
        .select(
          "id, student_id, class_id, has_transport, bus_stop_id, bus_id, transport_direction, transport_fee_override, pickup_address, students(full_name, admission_no), classes(name, section, streams(name))"
        )
        .eq("academic_year_id", year.id)
        .range(0, 9999),
      admin
        .from("bus_stop_fees")
        .select("*")
        .eq("academic_year_id", year.id)
        .eq("is_active", true),
    ]);

    if (enrollRes.error) {
      console.error(
        "Transport assignments: fetch enrollments error:",
        enrollRes.error
      );
      return NextResponse.json(
        { error: "Failed to load enrollments" },
        { status: 500 }
      );
    }

    return NextResponse.json({
      year,
      enrollments: enrollRes.data ?? [],
      fees: feesRes.data ?? [],
    });
  } catch (err) {
    console.error("Transport assignments fetch error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
