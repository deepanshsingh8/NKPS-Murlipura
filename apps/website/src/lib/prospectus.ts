import { cache } from "react";
import { createAdminClient } from "@nkps/shared/lib/supabase/admin";
import type { ProspectusDocument } from "@nkps/shared/types";

// cache(): generateMetadata (noindex while empty) and the page share one query.
export const getProspectusDocuments = cache(async (): Promise<ProspectusDocument[]> => {
  const supabase = createAdminClient();
  const { data } = await supabase
    .from("prospectus_documents")
    .select("*")
    .order("sort_order");
  return (data ?? []) as ProspectusDocument[];
});
