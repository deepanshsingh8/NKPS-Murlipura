import { createAdminClient } from "@nkps/shared/lib/supabase/admin";
import type { ProspectusDocument } from "@nkps/shared/types";

export async function getProspectusDocuments(): Promise<ProspectusDocument[]> {
  const supabase = createAdminClient();
  const { data } = await supabase
    .from("prospectus_documents")
    .select("*")
    .order("sort_order");
  return (data ?? []) as ProspectusDocument[];
}
