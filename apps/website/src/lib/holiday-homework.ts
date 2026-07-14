import { createAdminClient } from "@nkps/shared/lib/supabase/admin";
import type { HolidayHomework } from "@nkps/shared/types";

export async function getHolidayHomework(): Promise<HolidayHomework[]> {
  const supabase = createAdminClient();
  const { data } = await supabase
    .from("holiday_homework")
    .select("*")
    .order("sort_order");
  return (data ?? []) as HolidayHomework[];
}
