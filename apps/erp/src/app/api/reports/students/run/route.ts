import { NextResponse } from "next/server";
import { verifyAdminOrEditorWithUser } from "@nkps/shared/lib/verify-admin";
import { reportRunSchema } from "@nkps/shared/lib/report-filters";
import {
  resolveFields,
  applyFieldVisibility,
} from "@nkps/shared/lib/report-fields";
import { runStudentReport, toMatrix, ReportQueryError } from "@/lib/report-query";

export const runtime = "nodejs";

/**
 * POST /api/reports/students/run
 *
 * Preview for the report builder: runs the filters and returns one page of
 * resolved cells plus the total row count.
 *
 * Bearer-gated (`verifyAdminOrEditorWithUser`) because the client calls it via
 * adminFetch. The export route cannot use the same gate — a browser download
 * sends cookies, not a bearer token — so it does its own check.
 *
 * Filtering, projection, sorting and paging all happen server-side. Shipping
 * the student master to the browser and filtering there would hand every
 * caller every column regardless of what they selected, which is exactly the
 * leak the per-field `sensitive` gate exists to prevent.
 */
export async function POST(request: Request) {
  const caller = await verifyAdminOrEditorWithUser("reports");
  if (!caller) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = reportRunSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid report request", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const { filters, page, page_size: pageSize } = parsed.data;
  const isAdmin = caller.role === "admin";

  // Order matters: resolve first (adds the always-on columns, drops unknown
  // keys), then strip what this caller may not see. Doing it the other way
  // would let a sensitive key slip back in via the always-on set.
  const requested = resolveFields(filters.fields);
  const fields = applyFieldVisibility(requested, isAdmin);
  const withheld = requested.length - fields.length;

  try {
    const result = await runStudentReport(caller.admin, filters, fields);

    const start = (page - 1) * pageSize;
    const pageRows = result.rows.slice(start, start + pageSize);
    const { headers, body: cells } = toMatrix(pageRows, fields);

    return NextResponse.json({
      session: result.session,
      columns: fields.map((f) => ({
        key: f.key,
        label: f.label,
        numeric: f.numeric ?? false,
      })),
      headers,
      rows: cells,
      total: result.total,
      page,
      page_size: pageSize,
      // Surfaced rather than silent: an editor who ticked Aadhaar should be
      // told the column was withheld, not left wondering why it is missing.
      withheld_fields: withheld,
    });
  } catch (err) {
    if (err instanceof ReportQueryError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error("[reports.students.run]", err);
    return NextResponse.json({ error: "Failed to run report" }, { status: 500 });
  }
}
