// Shared handler behind each app's /api/export/table-pdf route.
//
// Mounted separately by the ERP and the CMS rather than shared over the wire:
// the two run on different origins (ports in dev, subdomains in production),
// so a single route in one app could not serve the other. The factory keeps
// them from drifting.

import { promises as fs } from "fs";
import path from "path";
import { NextResponse } from "next/server";
import { renderToBuffer } from "@react-pdf/renderer";

import { SCHOOL } from "@nkps/shared/lib/constants";
import { contentDispositionAttachment } from "@nkps/shared/lib/utils";
import { verifyStaffMember } from "@nkps/shared/lib/verify-admin";
import {
  PDF_MAX_BODY_BYTES,
  tablePdfPayloadSchema,
} from "@nkps/shared/lib/table-export-payload";
import { ListTablePDF } from "@nkps/shared/components/pdf/ListTablePDF";

/**
 * Cached across requests: the logo is a few KB read from disk, and re-reading
 * it per export is pure waste on a route that may be hit in bursts.
 */
let cachedLogo: Buffer | null = null;
let logoLookupDone = false;

async function loadLogo(): Promise<Buffer | null> {
  if (logoLookupDone) return cachedLogo;
  logoLookupDone = true;
  try {
    cachedLogo = await fs.readFile(
      path.join(process.cwd(), "public", "images", "logo.png")
    );
  } catch {
    cachedLogo = null;
  }
  return cachedLogo;
}

/**
 * Devanagari support is opt-in, because no font in this repo covers it.
 *
 * Every PDF here renders in built-in Helvetica, which has zero Devanagari
 * glyphs — Hindi in an address or a remark comes out blank, silently. Drop a
 * `NotoSansDevanagari-Regular.ttf` (and optionally `-Bold.ttf`) into the app's
 * `public/fonts/` and it is picked up automatically; without it we stay on
 * Helvetica rather than fail the download.
 */
let fontsResolved: { body: string; bold: string } | null = null;

async function resolveFonts(): Promise<{ body: string; bold: string }> {
  if (fontsResolved) return fontsResolved;

  const fallback = { body: "Helvetica", bold: "Helvetica-Bold" };
  const dir = path.join(process.cwd(), "public", "fonts");
  const regular = path.join(dir, "NotoSansDevanagari-Regular.ttf");

  try {
    await fs.access(regular);
    const bold = path.join(dir, "NotoSansDevanagari-Bold.ttf");
    const hasBold = await fs
      .access(bold)
      .then(() => true)
      .catch(() => false);

    const { Font } = await import("@react-pdf/renderer");
    Font.register({
      family: "NotoDevanagari",
      fonts: hasBold
        ? [
            { src: regular, fontWeight: "normal" },
            { src: bold, fontWeight: "bold" },
          ]
        : [{ src: regular, fontWeight: "normal" }],
    });
    fontsResolved = { body: "NotoDevanagari", bold: "NotoDevanagari" };
  } catch {
    fontsResolved = fallback;
  }
  return fontsResolved;
}

export interface RenderListPdfOptions {
  title: string;
  subtitle?: string;
  filterSummary: { label: string; value: string }[];
  headers: string[];
  aligns: ("left" | "right")[];
  rows: string[][];
  orientation?: "auto" | "portrait" | "landscape";
  generatedBy: string;
}

/**
 * Render a list to PDF bytes. Shared by this route and the per-domain export
 * routes, which produce the same document from server-queried rows.
 */
export async function renderListPdf({
  title,
  subtitle,
  filterSummary,
  headers,
  aligns,
  rows,
  orientation = "auto",
  generatedBy,
}: RenderListPdfOptions): Promise<Uint8Array<ArrayBuffer>> {
  const [logoData, fonts] = await Promise.all([loadLogo(), resolveFonts()]);
  const buffer = await renderToBuffer(
    <ListTablePDF
      school={{
        name: SCHOOL.name,
        address_line: SCHOOL.address.full,
        affiliation: SCHOOL.affiliation,
        affiliation_number: SCHOOL.affiliationNumber,
      }}
      title={title}
      subtitle={subtitle}
      filterSummary={filterSummary}
      headers={headers}
      aligns={aligns}
      rows={rows}
      orientation={orientation}
      logoData={logoData ?? undefined}
      generatedBy={generatedBy}
      generatedOn={GENERATED_ON.format(new Date())}
      bodyFont={fonts.body}
      boldFont={fonts.bold}
    />
  );
  // Copied into a plain ArrayBuffer-backed view: a Node Buffer is not a
  // valid BodyInit for the web Response the route returns.
  return new Uint8Array(
    buffer.buffer.slice(
      buffer.byteOffset,
      buffer.byteOffset + buffer.byteLength
    ) as ArrayBuffer
  );
}

export interface TablePdfHandlerConfig {
  /** Which app is serving this, for the audit row. */
  sourceApp: "erp" | "cms";
}

function actorLabel(
  user: { email?: string | null },
  role: string
): string {
  return `${user.email ?? "unknown user"} (${role})`;
}

const GENERATED_ON = new Intl.DateTimeFormat("en-IN", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Asia/Kolkata",
});

export function createTablePdfHandler({ sourceApp }: TablePdfHandlerConfig) {
  return async function POST(request: Request) {
    // Renders rows the caller already holds — it discloses nothing new — so
    // the gate is "signed-in staff", not a feature grant. verifyAdminOrEditor()
    // would reject a plain teacher exporting their own class list.
    const caller = await verifyStaffMember();
    if (!caller) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const raw = await request.text();
    if (raw.length > PDF_MAX_BODY_BYTES) {
      return NextResponse.json(
        {
          error:
            "That export is too large for a PDF. Narrow the filter, or download it as Excel.",
        },
        { status: 413 }
      );
    }

    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(raw);
    } catch {
      return NextResponse.json({ error: "Malformed request" }, { status: 400 });
    }

    // Validated before anything reaches the renderer: a bad body should be a
    // 400, not an exception inside renderToBuffer.
    const parsed = tablePdfPayloadSchema.safeParse(parsedJson);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid export request", detail: parsed.error.issues[0]?.message },
        { status: 400 }
      );
    }
    const payload = parsed.data;

    const bytes = await renderListPdf({
      title: payload.title,
      subtitle: payload.subtitle,
      filterSummary: payload.filterSummary,
      headers: payload.headers,
      aligns: payload.aligns,
      rows: payload.rows,
      orientation: payload.orientation,
      generatedBy: actorLabel(caller.user, caller.role),
    });

    // Fire-and-forget: an audit write must never be able to fail a download.
    void caller.admin
      .from("export_events")
      .insert({
        actor_id: caller.user.id,
        actor_role: caller.role,
        dataset: "table_pdf",
        feature_key: payload.featureKey ?? null,
        format: "pdf",
        row_count: payload.rows.length,
        column_count: payload.headers.length,
        fields: payload.headers,
        filter_summary: payload.filterSummary
          .map((f) => `${f.label}: ${f.value}`)
          .join(" · "),
        source_app: sourceApp,
        source_path: payload.sourcePath ?? null,
      })
      .then(
        () => undefined,
        (error: unknown) => {
          console.error("export_events insert failed:", error);
        }
      );

    return new NextResponse(bytes, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": contentDispositionAttachment(
          `${payload.filename}.pdf`
        ),
        "Cache-Control": "private, no-store",
      },
    });
  };
}
