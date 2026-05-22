import { NextRequest, NextResponse } from "next/server";
import { verifyAdmin } from "@nkps/shared/lib/verify-admin";
import { z } from "zod";

const VALID_KEYS = [
  "report_card",
  "admit_card",
  "white_sheet",
  "green_sheet",
  "blank_marks_list",
  "ptm_format",
] as const;

const headerSchema = z.object({
  school_name: z.string().min(1),
  address_line: z.string().min(1),
  affiliation: z.string().nullable().optional(),
  affiliation_number: z.string().nullable().optional(),
  logo_url: z.string().nullable().optional(),
  motto: z.string().nullable().optional(),
  is_active: z.boolean().optional(),
});

const footerSchema = z.object({
  disclaimer_text: z.string().nullable().optional(),
  show_signatures: z.boolean().optional(),
  signature_labels: z.array(z.string()).optional(),
  is_active: z.boolean().optional(),
});

const putSchema = z.object({
  template_key: z.enum(VALID_KEYS),
  header: headerSchema.optional(),
  footer: footerSchema.optional(),
});

export async function GET(request: NextRequest) {
  const admin = await verifyAdmin();
  if (!admin) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const templateKey = request.nextUrl.searchParams.get("template_key");

  if (templateKey) {
    // Single template view
    if (!VALID_KEYS.includes(templateKey as typeof VALID_KEYS[number])) {
      return NextResponse.json(
        { error: "Unknown template_key" },
        { status: 400 }
      );
    }
    const [headerRes, footerRes] = await Promise.all([
      admin
        .from("pdf_header_configs")
        .select("*")
        .eq("template_key", templateKey)
        .maybeSingle(),
      admin
        .from("pdf_footer_configs")
        .select("*")
        .eq("template_key", templateKey)
        .maybeSingle(),
    ]);
    return NextResponse.json({
      data: {
        template_key: templateKey,
        header: headerRes.data ?? null,
        footer: footerRes.data ?? null,
      },
    });
  }

  // List all known template keys with their (possibly null) configs.
  const [headerRes, footerRes] = await Promise.all([
    admin.from("pdf_header_configs").select("*"),
    admin.from("pdf_footer_configs").select("*"),
  ]);

  const headerByKey = new Map<string, unknown>();
  for (const h of headerRes.data ?? []) {
    headerByKey.set(h.template_key, h);
  }
  const footerByKey = new Map<string, unknown>();
  for (const f of footerRes.data ?? []) {
    footerByKey.set(f.template_key, f);
  }

  const rows = VALID_KEYS.map((key) => ({
    template_key: key,
    header: headerByKey.get(key) ?? null,
    footer: footerByKey.get(key) ?? null,
  }));

  return NextResponse.json({ data: rows });
}

export async function PUT(request: NextRequest) {
  const admin = await verifyAdmin();
  if (!admin) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const parsed = putSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid data", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const { template_key, header, footer } = parsed.data;
  const now = new Date().toISOString();

  if (header) {
    const { error } = await admin
      .from("pdf_header_configs")
      .upsert(
        {
          template_key,
          school_name: header.school_name,
          address_line: header.address_line,
          affiliation: header.affiliation ?? null,
          affiliation_number: header.affiliation_number ?? null,
          logo_url: header.logo_url ?? null,
          motto: header.motto ?? null,
          is_active: header.is_active ?? true,
          updated_at: now,
        },
        { onConflict: "template_key" }
      );
    if (error) {
      console.error("[pdf-templates.PUT] header upsert:", error);
      return NextResponse.json({ error: "Failed to update PDF header" }, { status: 500 });
    }
  }

  if (footer) {
    const { error } = await admin
      .from("pdf_footer_configs")
      .upsert(
        {
          template_key,
          disclaimer_text: footer.disclaimer_text ?? null,
          show_signatures: footer.show_signatures ?? true,
          signature_labels: footer.signature_labels ?? [
            "Class Teacher",
            "Principal",
          ],
          is_active: footer.is_active ?? true,
          updated_at: now,
        },
        { onConflict: "template_key" }
      );
    if (error) {
      console.error("[pdf-templates.PUT] footer upsert:", error);
      return NextResponse.json({ error: "Failed to update PDF footer" }, { status: 500 });
    }
  }

  return NextResponse.json({ data: { template_key } });
}
