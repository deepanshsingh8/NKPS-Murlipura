import { createAdminClient } from "@nkps/shared/lib/supabase/admin";
import type { CalendarEvent } from "@nkps/shared/types";

export type PublicCalendarEvent = Pick<
  CalendarEvent,
  "id" | "title" | "description" | "event_type" | "start_date" | "end_date"
>;

/**
 * Upcoming school-wide public events (home page + /academic-calendar).
 * The admin client bypasses RLS, so `is_public` (the anon SELECT policy) is
 * filtered explicitly, and only the columns the page renders are selected.
 */
export async function getUpcomingSchoolEvents(
  limit?: number
): Promise<PublicCalendarEvent[]> {
  const supabase = createAdminClient();
  const today = new Date().toISOString().split("T")[0];

  let query = supabase
    .from("calendar_events")
    .select("id, title, description, event_type, start_date, end_date")
    .eq("is_public", true)
    .gte("start_date", today)
    .is("class_id", null) // Only school-wide events
    .order("start_date", { ascending: true });
  if (limit) query = query.limit(limit);

  const { data } = await query;

  return (data ?? []) as PublicCalendarEvent[];
}
