import { cache } from "react";
import { createAdminClient } from "@nkps/shared/lib/supabase/admin";
import type { HolidayHomework } from "@nkps/shared/types";

// cache(): generateMetadata (noindex while empty) and the page share one query.
export const getHolidayHomework = cache(async (): Promise<HolidayHomework[]> => {
  const supabase = createAdminClient();
  const { data } = await supabase
    .from("holiday_homework")
    .select("*")
    .order("sort_order");
  return (data ?? []) as HolidayHomework[];
});
