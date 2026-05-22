// PDF template config loader for report cards, admit cards, etc.
//
// Admin can edit per-template header/footer rows in `pdf_header_configs`
// and `pdf_footer_configs`. Callers resolve the config via the helpers
// below; missing rows transparently fall back to the hardcoded SCHOOL
// constants so a partial setup (or a fresh DB without seed data) never
// blocks PDF generation.

import type { SupabaseClient } from "@supabase/supabase-js";
import { SCHOOL } from "@nkps/shared/lib/constants";

export type TemplateKey =
  | "report_card"
  | "admit_card"
  | "white_sheet"
  | "green_sheet"
  | "blank_marks_list"
  | "ptm_format";

export interface PdfHeader {
  school_name: string;
  address_line: string;
  affiliation: string | null;
  affiliation_number: string | null;
  logo_url: string | null;
  motto: string | null;
}

export interface PdfFooter {
  disclaimer_text: string | null;
  show_signatures: boolean;
  signature_labels: string[];
}

const HARDCODED_HEADER_FALLBACK: PdfHeader = {
  school_name: SCHOOL.name,
  address_line: SCHOOL.address.full,
  affiliation: SCHOOL.affiliation,
  affiliation_number: SCHOOL.affiliationNumber,
  logo_url: "/images/logo.png",
  motto: null,
};

const HARDCODED_FOOTER_FALLBACK: PdfFooter = {
  disclaimer_text: "This is a computer-generated document.",
  show_signatures: true,
  signature_labels: ["Class Teacher", "Principal"],
};

/**
 * Fetch the header config for a template. Returns the hardcoded fallback if
 * no row exists or the row is inactive. Safe to call from server components.
 */
export async function getPdfHeader(
  supabase: SupabaseClient,
  templateKey: TemplateKey
): Promise<PdfHeader> {
  const { data, error } = await supabase
    .from("pdf_header_configs")
    .select(
      "school_name, address_line, affiliation, affiliation_number, logo_url, motto, is_active"
    )
    .eq("template_key", templateKey)
    .maybeSingle();

  if (error || !data || !data.is_active) {
    return HARDCODED_HEADER_FALLBACK;
  }

  return {
    school_name: data.school_name as string,
    address_line: data.address_line as string,
    affiliation: (data.affiliation as string | null) ?? null,
    affiliation_number: (data.affiliation_number as string | null) ?? null,
    logo_url: (data.logo_url as string | null) ?? null,
    motto: (data.motto as string | null) ?? null,
  };
}

export async function getPdfFooter(
  supabase: SupabaseClient,
  templateKey: TemplateKey
): Promise<PdfFooter> {
  const { data, error } = await supabase
    .from("pdf_footer_configs")
    .select(
      "disclaimer_text, show_signatures, signature_labels, is_active"
    )
    .eq("template_key", templateKey)
    .maybeSingle();

  if (error || !data || !data.is_active) {
    return HARDCODED_FOOTER_FALLBACK;
  }

  const labels = Array.isArray(data.signature_labels)
    ? (data.signature_labels as unknown[]).filter(
        (x): x is string => typeof x === "string"
      )
    : HARDCODED_FOOTER_FALLBACK.signature_labels;

  return {
    disclaimer_text: (data.disclaimer_text as string | null) ?? null,
    show_signatures: Boolean(data.show_signatures ?? true),
    signature_labels: labels.length > 0 ? labels : HARDCODED_FOOTER_FALLBACK.signature_labels,
  };
}

/**
 * Convenience: fetch both in parallel.
 */
export async function getPdfTemplate(
  supabase: SupabaseClient,
  templateKey: TemplateKey
): Promise<{ header: PdfHeader; footer: PdfFooter }> {
  const [header, footer] = await Promise.all([
    getPdfHeader(supabase, templateKey),
    getPdfFooter(supabase, templateKey),
  ]);
  return { header, footer };
}
