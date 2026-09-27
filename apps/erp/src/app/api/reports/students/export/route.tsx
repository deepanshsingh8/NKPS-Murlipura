import { NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { promises as fs } from "fs";
import path from "path";
import { renderToBuffer } from "@react-pdf/renderer";
import { createClient } from "@nkps/shared/lib/supabase/server";
import { createAdminClient } from "@nkps/shared/lib/supabase/admin";
import { contentDispositionAttachment, csvEscape } from "@nkps/shared/lib/utils";
import {
  reportFiltersSchema,
  REPORT_EXPORT_FORMATS,
  type ReportExportFormat,
} from "@nkps/shared/lib/report-filters";
import {
  resolveFields,
  applyFieldVisibility,
} from "@nkps/shared/lib/report-fields";
import { runStudentReport, toMatrix, ReportQueryError } from "@/lib/report-query";
import { getPdfTemplate } from "@/lib/pdf-templates";
import { ReportPDF } from "@/components/pdf/ReportPDF";
import { todayISO } from "@nkps/shared/lib/date";

export const runtime = "nodejs";

/**
 * Hard cap on PDF columns. Past this the landscape A4 grid gives each column
 * under ~13mm and every value wraps to unreadable slivers. Excel has no such
 * limit, so the error says so rather than silently producing a bad sheet.
 */
const PDF_MAX_COLUMNS = 20;

let cachedLogo: Buffer | null = null;
async function loadLogo(): Promise<Buffer | null> {
  if (cachedLogo) return cachedLogo;
  try {
    cachedLogo = await fs.readFile(
      path.join(process.cwd(), "public", "images", "logo.png")
    );
    return cachedLogo;
  } catch {
    // A missing logo must not fail the export — the header just renders
    // without it.
    return null;
  }
}

/**
 * POST /api/reports/students/export?format=csv|xlsx
 *
 * ── Why this route authenticates by hand ────────────────────────────────────
 * `verifyAdminOrEditor` reads a bearer token from the Authorization header. A
 * file download is a form post or a plain navigation, which carries cookies
 * and no bearer token, so that helper would return null for a perfectly valid
 * admin. This is the same cookie-client + explicit editor_permissions lookup
 * that /api/green-sheet/csv uses, with the query then run on the service-role
 * client because the underlying tables have no editor SELECT policy.
 *
 * POST rather than GET: the filter set plus a 100-key field list does not fit
 * comfortably in a URL, and putting a student name search in a query string
 * writes it into access logs.
 */
export async function POST(request: Request) {
  // ── Auth ──────────────────────────────────────────────────────────────────
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("role, must_change_password")
    .eq("id", user.id)
    .single();
  if (!profile || profile.must_change_password) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const isAdmin = profile.role === "admin";
  if (!isAdmin) {
    const { data: perm } = await supabase
      .from("editor_permissions")
      .select("feature_key")
      .eq("editor_id", user.id)
      .eq("feature_key", "reports")
      .maybeSingle();
    if (!perm) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
  }

  // ── Request ───────────────────────────────────────────────────────────────
  const format = (new URL(request.url).searchParams.get("format") ??
    "csv") as ReportExportFormat;
  if (!REPORT_EXPORT_FORMATS.includes(format)) {
    return NextResponse.json(
      { error: `Unsupported format: ${format}` },
      { status: 400 }
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = reportFiltersSchema.safeParse(
    (body as { filters?: unknown })?.filters ?? body
  );
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid report request", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const filters = parsed.data;
  const fields = applyFieldVisibility(resolveFields(filters.fields), isAdmin);

  // ── Run ───────────────────────────────────────────────────────────────────
  let result;
  try {
    // Service-role: `students` and `student_enrollments` have no editor SELECT
    // policy, so a cookie-scoped read returns an empty sheet rather than an
    // error — the failure mode audit #29 documented on the green sheet.
    result = await runStudentReport(createAdminClient(), filters, fields);
  } catch (err) {
    if (err instanceof ReportQueryError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error("[reports.students.export]", err);
    return NextResponse.json({ error: "Failed to run report" }, { status: 500 });
  }

  const { headers, body: cells } = toMatrix(result.rows, fields);

  // Audit trail — the `export_events` table from migration 091, the same one
  // the admin-list downloads write to. One screen can export the entire
  // student master, so the record of who did it belongs beside those.
  //
  // Fire-and-forget on purpose: an audit write must never be able to fail the
  // download it describes. A failure is logged and the file still goes out.
  void createAdminClient()
    .from("export_events")
    .insert({
      actor_id: user.id,
      actor_role: isAdmin ? "admin" : "editor",
      dataset: "students",
      feature_key: "reports",
      format,
      academic_year_id: result.session.id,
      row_count: result.total,
      column_count: fields.length,
      fields: fields.map((f) => f.key),
      // The flag worth alerting on: did this download carry PII? Only an admin
      // can make it true, because the visibility filter strips those fields
      // for everyone else before we get here.
      sensitive: fields.some((f) => f.sensitive),
      filter_summary: [
        `Session: ${result.session.name}`,
        result.classLabels.length ? `Classes: ${result.classLabels.join(", ")}` : null,
        `Status: ${filters.statuses.join(", ")}`,
      ]
        .filter(Boolean)
        .join(" · "),
      filter_spec: filters,
      source_app: "erp",
      source_path: "/reports/students",
    })
    .then(
      () => undefined,
      (error: unknown) => {
        console.error("export_events insert failed:", error);
      }
    );

  const stamp = todayISO();
  const filename = `student-report-${result.session.name}-${stamp}`;

  if (format === "csv") {
    // csvEscape, not manual quoting: it also neutralises leading = + - @, and
    // student names and addresses are attacker-controllable via bulk import.
    const lines = [
      headers.map(csvEscape).join(","),
      ...cells.map((row) => row.map(csvEscape).join(",")),
    ];
    // BOM so Excel opens UTF-8 names (Hindi, diacritics) correctly instead of
    // rendering them as mojibake.
    return new NextResponse(`﻿${lines.join("\r\n")}`, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": contentDispositionAttachment(`${filename}.csv`),
        "Cache-Control": "no-store",
      },
    });
  }

  if (format === "pdf") {
    if (fields.length > PDF_MAX_COLUMNS) {
      return NextResponse.json(
        {
          error:
            `${fields.length} columns is too many to print legibly ` +
            `(limit ${PDF_MAX_COLUMNS}). Narrow the selection, or export to Excel.`,
        },
        { status: 400 }
      );
    }

    const { header, footer } = await getPdfTemplate(supabase, "student_report");
    const logoData = await loadLogo();

    // Describe the filters in words on the sheet itself. A printed list with
    // no visible scope cannot be filed or checked later — the reader has no
    // way to know which session or classes produced it.
    const scope = [`Session ${result.session.name}`];
    if (result.classLabels.length) {
      scope.push(`Classes: ${result.classLabels.join(", ")}`);
    }
    scope.push(
      filters.statuses.length === 1
        ? `${filters.statuses[0]} students`
        : `Status: ${filters.statuses.join(", ")}`
    );

    const buffer = await renderToBuffer(
      <ReportPDF
        school={{
          name: header.school_name,
          address_line: header.address_line,
          affiliation: header.affiliation,
          affiliation_number: header.affiliation_number,
        }}
        title="Student Custom Report"
        subtitle={scope.join("  ·  ")}
        columns={fields.map((f) => ({
          label: f.label,
          width: f.width ?? 14,
          numeric: f.numeric ?? false,
          blank: f.source === "blank",
        }))}
        rows={cells}
        logoData={logoData ?? undefined}
        generatedOn={new Date().toLocaleString("en-IN", {
          timeZone: "Asia/Kolkata",
          day: "2-digit",
          month: "short",
          year: "numeric",
          hour: "2-digit",
          minute: "2-digit",
        })}
        footerNote={footer.disclaimer_text}
      />
    );

    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": contentDispositionAttachment(`${filename}.pdf`),
        "Cache-Control": "private, no-store",
      },
    });
  }

  // xlsx
  const sheet = XLSX.utils.aoa_to_sheet([headers, ...cells]);
  sheet["!cols"] = fields.map((f) => ({ wch: f.width ?? 14 }));
  // Freeze the header row — a 100-column report is unreadable without it.
  sheet["!freeze"] = { xSplit: "0", ySplit: "1" };
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, "Students");
  const buffer = XLSX.write(book, { type: "buffer", bookType: "xlsx" });

  return new NextResponse(buffer, {
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": contentDispositionAttachment(`${filename}.xlsx`),
      "Cache-Control": "no-store",
    },
  });
}
