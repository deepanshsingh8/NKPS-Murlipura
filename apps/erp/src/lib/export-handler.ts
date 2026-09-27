// Shared skeleton for the server-side ("Tier B") export routes.
//
// The sensitive datasets — students, staff, fees, transport, users — are
// generated here rather than in the browser, for two reasons that the
// operational tables do not have:
//
//  1. They must be auditable. A client-side download can only be logged by a
//     beacon the client chooses to send, and a log with holes reads as
//     complete when it is not. Generating server-side makes export_events
//     genuinely complete for exactly the data worth logging.
//  2. They must be able to answer questions the page payload cannot — a past
//     academic session, a subject join, computed fee dues.
//
// Each route supplies the query and the columns; everything below is common.

import { NextResponse } from "next/server";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import { z } from "zod";

import { contentDispositionAttachment } from "@nkps/shared/lib/utils";
import { renderListPdf } from "@nkps/shared/lib/table-pdf-handler";
import { EXPORT_SENSITIVE_KEYS } from "@nkps/shared/lib/pii-fields";
import {
  buildExportMatrix,
  exportAligns,
  matrixToText,
  toCsv,
  UTF8_BOM,
  type ExportColumn,
  type ExportFileFormat,
} from "@nkps/shared/lib/table-export";
import {
  buildXlsxBytes,
  XLSX_MIME,
} from "@nkps/shared/lib/table-export-xlsx";

export const exportRequestSchema = z.object({
  format: z.enum(["csv", "xlsx", "pdf"]),
  /** Column keys, in the order the admin arranged them. */
  fields: z.array(z.string().max(80)).max(200).default([]),
  academic_year_id: z.string().uuid().nullish(),
  title: z.string().max(120).default("Export"),
  filename: z.string().max(160).default("export"),
  filterSummary: z
    .array(z.object({ label: z.string().max(80), value: z.string().max(400) }))
    .max(20)
    .default([]),
  /**
   * The exact rows to export, when the caller already knows them.
   *
   * The dialog sends these for the session on screen, which is what makes
   * the file provably identical to the filtered table: the server enriches
   * and gates the columns, but does not re-decide membership. Omitted only
   * when exporting a session the browser never loaded, where the server has
   * to rebuild the set from `filter`.
   */
  row_ids: z.array(z.string().uuid()).max(20000).optional(),
  /** Domain-specific narrowing; each route validates its own shape. */
  filter: z.record(z.string(), z.unknown()).optional(),
});

export type ExportRequest = z.infer<typeof exportRequestSchema>;

/**
 * Fields withheld from anyone who is not an admin.
 *
 * The point is not to stop an editor seeing a phone number — they can already
 * open the student's record. It is to stop the whole school's contact details
 * leaving in one file, which is a different act from looking one child up.
 * Enforced here rather than in the UI because a client-side filter is a
 * suggestion.
 */
export const SENSITIVE_FIELDS = EXPORT_SENSITIVE_KEYS;

export interface ExportActor {
  admin: SupabaseClient;
  user: User;
  role: string;
}

export interface RunExportOptions<T> {
  request: ExportRequest;
  actor: ExportActor;
  /** Matches the `dataset` CHECK on export_events. */
  dataset:
    | "students"
    | "staff"
    | "fees_dues"
    | "transport_assignments"
    | "users"
    | "registrations";
  featureKey: string;
  /** Every column this dataset can export, keyed as the client names them. */
  available: Record<string, ExportColumn<T>>;
  /** Used when the request names no fields. */
  defaultFields: string[];
  rows: readonly T[];
  /** Extra provenance for the PDF sub-header, e.g. the session name. */
  subtitle?: string;
}

/** Excel refuses more than this; well past it the file is not a list anyway. */
const MAX_EXPORT_ROWS = 20000;

export function resolveFields<T>(
  request: ExportRequest,
  available: Record<string, ExportColumn<T>>,
  defaultFields: string[],
  role: string
): { columns: ExportColumn<T>[]; omitted: number } {
  const requested = request.fields.length > 0 ? request.fields : defaultFields;
  // Unknown keys are dropped rather than rejected: an older tab asking for a
  // field that has since been renamed should still get its export.
  const known = requested.filter((key) => key in available);
  const allowed =
    role === "admin" ? known : known.filter((key) => !SENSITIVE_FIELDS.has(key));
  return {
    columns: allowed.map((key) => available[key]),
    omitted: known.length - allowed.length,
  };
}

export async function runExport<T>({
  request,
  actor,
  dataset,
  featureKey,
  available,
  defaultFields,
  rows,
  subtitle,
}: RunExportOptions<T>): Promise<NextResponse> {
  const { columns, omitted } = resolveFields(
    request,
    available,
    defaultFields,
    actor.role
  );

  if (columns.length === 0) {
    return NextResponse.json(
      { error: "No exportable columns were selected." },
      { status: 400 }
    );
  }
  if (rows.length > MAX_EXPORT_ROWS) {
    return NextResponse.json(
      {
        error: `That is ${rows.length.toLocaleString("en-IN")} rows. Narrow the filter and try again.`,
      },
      { status: 413 }
    );
  }

  const headers = columns.map((column) => column.header);
  const matrix = buildExportMatrix(rows, columns);

  let body: Uint8Array<ArrayBuffer>;
  let contentType: string;

  if (request.format === "csv") {
    // The BOM is what makes Excel read it as UTF-8; without it the ₹ sign and
    // any Hindi name arrive as mojibake.
    body = new TextEncoder().encode(UTF8_BOM + toCsv(headers, matrix));
    contentType = "text/csv; charset=utf-8";
  } else if (request.format === "xlsx") {
    body = await buildXlsxBytes(columns, matrix, { sheetName: request.title });
    contentType = XLSX_MIME;
  } else {
    body = await renderListPdf({
      title: request.title,
      subtitle,
      filterSummary: request.filterSummary,
      headers,
      aligns: exportAligns(columns),
      rows: matrixToText(matrix),
      generatedBy: `${actor.user.email ?? "unknown user"} (${actor.role})`,
    });
    contentType = "application/pdf";
  }

  logExport({
    actor,
    dataset,
    featureKey,
    request,
    rowCount: rows.length,
    fields: columns.map((column) => column.key),
  });

  return new NextResponse(body, {
    headers: {
      "Content-Type": contentType,
      "Content-Disposition": contentDispositionAttachment(
        `${request.filename}.${request.format}`
      ),
      "Cache-Control": "private, no-store",
      // Surfaced so the dialog can tell the admin why a column they ticked is
      // missing, rather than leaving them to notice it themselves.
      "X-Export-Omitted-Fields": String(omitted),
      "X-Export-Row-Count": String(rows.length),
    },
  });
}

interface LogExportOptions {
  actor: ExportActor;
  dataset: RunExportOptions<unknown>["dataset"];
  featureKey: string;
  request: ExportRequest;
  rowCount: number;
  fields: string[];
}

/**
 * Fire-and-forget. An audit row that could fail the download it describes
 * would be traded away the first time it caused an outage.
 */
function logExport({
  actor,
  dataset,
  featureKey,
  request,
  rowCount,
  fields,
}: LogExportOptions): void {
  void actor.admin
    .from("export_events")
    .insert({
      actor_id: actor.user.id,
      actor_role: actor.role,
      dataset,
      feature_key: featureKey,
      format: request.format satisfies ExportFileFormat,
      academic_year_id: request.academic_year_id ?? null,
      row_count: rowCount,
      column_count: fields.length,
      fields,
      sensitive: fields.some((field) => SENSITIVE_FIELDS.has(field)),
      filter_summary: request.filterSummary
        .map((f) => `${f.label}: ${f.value}`)
        .join(" · "),
      filter_spec: request.filter ?? null,
      source_app: "erp",
    })
    .then(
      () => undefined,
      (error: unknown) => {
        console.error("export_events insert failed:", error);
      }
    );
}
