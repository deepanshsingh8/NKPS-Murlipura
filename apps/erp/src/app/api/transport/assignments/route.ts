import { NextResponse } from "next/server";
import { verifyAdminOrEditor } from "@nkps/shared/lib/verify-admin";
import { fetchAllRows } from "@nkps/shared/lib/fetch-all-rows";

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
export async function GET(request: Request) {
  try {
    const admin = await verifyAdminOrEditor("transport");
    if (!admin) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // An explicit ?academic_year_id= overrides the active-year rule below, so
    // the page's session picker can show a past year's assignments.
    const requestedYearId = new URL(request.url).searchParams.get(
      "academic_year_id"
    );

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
    const year =
      (requestedYearId ? years.find((y) => y.id === requestedYearId) : null) ??
      years.find((y) => y.is_current) ??
      years[0] ??
      null;

    if (!year) {
      return NextResponse.json({ year: null, enrollments: [], fees: [] });
    }

    // Paged. `.range(0, 9999)` never pushed past PostgREST's 1000-row cap — a
    // Range header can only ask for less than it — so a full school's
    // enrolments stopped at a thousand and the students past that simply were
    // not on the screen the office assigns stops from. Ordered by id so the
    // pages are disjoint.
    const [enrollRes, feesRes] = await Promise.all([
      fetchAllRows((from, to) =>
        admin
          .from("student_enrollments")
          .select(
            "id, student_id, class_id, status, has_transport, bus_stop_id, bus_id, transport_direction, transport_fee_override, pickup_address, students(full_name, admission_no), classes(name, section, streams(name))"
          )
          .eq("academic_year_id", year.id)
          .order("id", { ascending: true })
          .range(from, to)
      ),
      admin
        .from("bus_stop_fees")
        .select("*")
        .eq("academic_year_id", year.id)
        .eq("is_active", true),
    ]);

    if (enrollRes.error || enrollRes.truncated) {
      console.error(
        "Transport assignments: fetch enrollments error:",
        enrollRes.error ?? "read stopped at the paging guard"
      );
      return NextResponse.json(
        { error: "Failed to load enrollments" },
        { status: 500 }
      );
    }

    return NextResponse.json({
      year,
      enrollments: enrollRes.data,
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
