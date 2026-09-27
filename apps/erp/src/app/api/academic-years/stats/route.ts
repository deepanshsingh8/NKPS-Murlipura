// Headline numbers per academic session, for the session archive.
//
// The point of the archive is year-on-year comparison — "we had 812 students in
// 2023-24 and 867 now", "14 left mid-year that session" — which the per-student
// timeline cannot answer because it only ever shows one child.
//
// Every figure is computed from three unfiltered, bounded reads and grouped in
// memory rather than one query per session. A school with eight years of
// history would otherwise cost twenty-four round trips to render one table.

import { NextResponse } from "next/server";
import { getCallerAccess } from "@nkps/shared/lib/verify-admin";
import {
  fetchAllRows,
  type PagedResult,
} from "@nkps/shared/lib/fetch-all-rows";

export const runtime = "nodejs";

// PostgREST caps a response at Supabase's db-max-rows (1000), and a `Range`
// header cannot lift that cap — it can only ask for less. These three reads
// are unfiltered by design (one pass over the whole history, grouped in
// memory), so they are the reads most certain to cross it: a school in its
// third session already holds more enrolments than the cap, and the archive
// was comparing sessions from whatever thousand rows came back first.

/** Payment rows that represent money actually received. */
const COLLECTED_STATUSES = ["paid", "partial"];

export interface AcademicYearStats {
  academic_year_id: string;
  students: number;
  classes: number;
  /** Enrollments closed as exited or terminated — the mid-year attrition. */
  left: number;
  /** Sum of amount_paid, less refunds. Omitted without the `fees` grant. */
  collected: number | null;
  /** True when some payments in this session carry no year and are excluded. */
  collected_partial: boolean;
}

export async function GET() {
  const caller = await getCallerAccess();
  if (!caller || (!caller.isAdmin && !caller.permissions.has("academic_years"))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { admin } = caller;

  // Money is behind its own grant. Reading the sessions list is not a reason
  // to learn what the school collected in each of them, so the totals are
  // withheld from an editor who holds `academic_years` but not `fees` — and
  // withheld here rather than hidden in the UI.
  const canSeeFees = caller.isAdmin || caller.permissions.has("fees");

  try {
    const [enrollmentsRes, classesRes, paymentsRes] = await Promise.all([
      // Ordered by id so the pages are disjoint — LIMIT/OFFSET without a total
      // order can repeat a row at a page boundary while dropping another, and
      // here that would move a student between two sessions' counts.
      fetchAllRows<{ academic_year_id: string | null; status: string | null }>(
        (from, to) =>
          admin
            .from("student_enrollments")
            .select("academic_year_id, status")
            .order("id", { ascending: true })
            .range(from, to)
      ),
      fetchAllRows<{ academic_year_id: string | null }>((from, to) =>
        admin
          .from("classes")
          .select("academic_year_id")
          .order("id", { ascending: true })
          .range(from, to)
      ),
      canSeeFees
        ? fetchAllRows<{
            academic_year_id: string | null;
            amount_paid: number | null;
            refund_amount: number | null;
            status: string | null;
          }>((from, to) =>
            admin
              .from("fee_payments")
              .select("academic_year_id, amount_paid, refund_amount, status")
              .in("status", COLLECTED_STATUSES)
              .order("id", { ascending: true })
              .range(from, to)
          )
        : ({ data: [], error: null, truncated: false } as PagedResult<{
            academic_year_id: string | null;
            amount_paid: number | null;
            refund_amount: number | null;
            status: string | null;
          }>),
    ]);

    for (const [label, res] of [
      ["enrollments", enrollmentsRes],
      ["classes", classesRes],
      ["payments", paymentsRes],
    ] as const) {
      // A short read is failed, not published: every figure here is a total,
      // and a total built from part of the table is wrong in a way nothing on
      // the screen would show.
      if (res.error || res.truncated) {
        console.error(
          `Session stats: ${label} query failed:`,
          res.error ?? "read stopped at the paging guard"
        );
        return NextResponse.json(
          { error: "Failed to build session summary" },
          { status: 500 }
        );
      }
    }

    const stats = new Map<string, AcademicYearStats>();
    const ensure = (id: string): AcademicYearStats => {
      let row = stats.get(id);
      if (!row) {
        row = {
          academic_year_id: id,
          students: 0,
          classes: 0,
          left: 0,
          collected: canSeeFees ? 0 : null,
          collected_partial: false,
        };
        stats.set(id, row);
      }
      return row;
    };

    for (const e of enrollmentsRes.data) {
      if (!e.academic_year_id) continue;
      const row = ensure(e.academic_year_id);
      row.students += 1;
      if (e.status === "exited" || e.status === "terminated") row.left += 1;
    }

    for (const c of classesRes.data) {
      if (!c.academic_year_id) continue;
      ensure(c.academic_year_id).classes += 1;
    }

    // `fee_payments.academic_year_id` is nullable — it was backfilled by
    // migration 048, and a row that predates it or was written without one
    // cannot be attributed to a session. Those are excluded and the response
    // says so, rather than quietly under-reporting a year's collection.
    let unattributed = 0;
    for (const p of paymentsRes.data) {
      if (!p.academic_year_id) {
        unattributed += 1;
        continue;
      }
      const row = ensure(p.academic_year_id);
      row.collected = (row.collected ?? 0) + (p.amount_paid ?? 0) - (p.refund_amount ?? 0);
    }

    return NextResponse.json({
      data: [...stats.values()],
      unattributed_payments: unattributed,
      includes_fees: canSeeFees,
    });
  } catch (error) {
    console.error("Session stats failed:", error);
    return NextResponse.json(
      { error: "Failed to build session summary" },
      { status: 500 }
    );
  }
}
