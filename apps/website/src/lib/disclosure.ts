import { createAdminClient } from "@nkps/shared/lib/supabase/admin";
import type {
  DisclosureItem,
  DisclosureDocument,
  DisclosureBoardResult,
} from "@nkps/shared/types";

export async function getDisclosureItems(): Promise<DisclosureItem[]> {
  const supabase = createAdminClient();
  const { data } = await supabase
    .from("disclosure_items")
    .select("*")
    .order("section")
    .order("sort_order");
  return (data ?? []) as DisclosureItem[];
}

export async function getDisclosureDocuments(): Promise<DisclosureDocument[]> {
  const supabase = createAdminClient();
  const { data } = await supabase
    .from("disclosure_documents")
    .select("*")
    .order("sort_order");
  return (data ?? []) as DisclosureDocument[];
}

export async function getDisclosureBoardResults(): Promise<
  DisclosureBoardResult[]
> {
  const supabase = createAdminClient();
  const { data } = await supabase
    .from("disclosure_board_results")
    .select("*")
    .order("exam_class")
    .order("sort_order");
  return (data ?? []) as DisclosureBoardResult[];
}
