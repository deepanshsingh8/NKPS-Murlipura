import { createAdminProxyHandler } from "@nkps/shared/lib/admin-proxy";
import type { FeatureKey } from "@nkps/shared/lib/permissions";

// CMS-side admin DB proxy. Tables here are the ones CMS pages write through
// adminApi() (gallery, disclosure, site_media features). ERP-owned tables
// (students, classes, fees, etc.) have their own /api/admin route on apps/erp.
const TABLE_FEATURE_KEY: Record<string, FeatureKey> = {
  gallery_events: "gallery",
  section_cards: "site_media",
  disclosure_items: "disclosure",
  disclosure_documents: "disclosure",
  disclosure_board_results: "disclosure",
};

const ALLOWED_COLUMNS: Record<string, string[]> = {
  gallery_events: ["id", "title", "description", "event_date", "academic_year", "cover_image_url", "is_public", "sort_order", "created_at", "updated_at"],
  section_cards: ["id", "section", "title", "subtitle", "description", "quote", "name", "role", "initials", "date", "cta_text", "cta_link", "icon", "link", "image_url", "designation", "message", "year", "season", "sort_order", "is_active", "created_at", "updated_at"],
  disclosure_items: ["id", "section", "field_key", "label", "value", "sort_order", "updated_at"],
  disclosure_documents: ["id", "doc_key", "label", "file_url", "file_name", "sort_order", "updated_at"],
  disclosure_board_results: ["id", "exam_class", "academic_year", "registered", "passed", "pass_percentage", "remarks", "sort_order", "updated_at"],
};

export const POST = createAdminProxyHandler({
  tableFeatureKey: TABLE_FEATURE_KEY,
  allowedColumns: ALLOWED_COLUMNS,
});
