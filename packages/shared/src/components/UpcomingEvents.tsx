"use client";

import { useEffect, useState } from "react";
import { createClient } from "@nkps/shared/lib/supabase/client";
import { Card, CardContent } from "@nkps/shared/components/ui/card";
import { Badge } from "@nkps/shared/components/ui/badge";
import { CalendarDays } from "lucide-react";
import type { CalendarEvent, CalendarEventType } from "@nkps/shared/types";

const EVENT_TYPE_LABELS: Record<CalendarEventType, string> = {
  exam: "Exam",
  holiday: "Holiday",
  event: "Event",
  pta_meeting: "PTA Meeting",
  sports: "Sports",
  cultural: "Cultural",
  other: "Other",
};

const EVENT_TYPE_COLORS: Record<CalendarEventType, string> = {
  exam: "bg-blue-100 text-blue-700",
  holiday: "bg-green-100 text-green-700",
  event: "bg-amber-100 text-amber-700",
  pta_meeting: "bg-purple-100 text-purple-700",
  sports: "bg-orange-100 text-orange-700",
  cultural: "bg-pink-100 text-pink-700",
  other: "bg-gray-100 text-gray-700",
};

interface UpcomingEventsProps {
  limit?: number;
  classId?: string;
  classIds?: string[];
  /**
   * When true, always include school-wide (class_id IS NULL) events even if
   * classIds is empty. Useful for role pages where the user has no enrolled
   * class yet — they should still see holidays, PTA meetings, etc.
   */
  includeSchoolWide?: boolean;
}

export function UpcomingEvents({
  limit = 5,
  classId,
  classIds,
  includeSchoolWide = false,
}: UpcomingEventsProps) {
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [loading, setLoading] = useState(true);

  // Normalize to a sorted, stable JSON key so the effect re-runs on content
  // change but not on unrelated array identity changes.
  const resolvedClassIds = classIds ?? (classId ? [classId] : []);
  const classIdsKey = [...resolvedClassIds].sort().join(",");

  useEffect(() => {
    async function fetchEvents() {
      const supabase = createClient();
      const today = new Date().toISOString().split("T")[0];

      let query = supabase
        .from("calendar_events")
        .select("*")
        .gte("start_date", today)
        .order("start_date", { ascending: true })
        .limit(limit);

      const ids = classIdsKey ? classIdsKey.split(",") : [];
      if (ids.length === 1) {
        query = query.or(`class_id.is.null,class_id.eq.${ids[0]}`);
      } else if (ids.length > 1) {
        query = query.or(
          `class_id.is.null,class_id.in.(${ids.join(",")})`
        );
      } else if (includeSchoolWide) {
        query = query.is("class_id", null);
      }

      const { data } = await query;
      setEvents((data as CalendarEvent[]) ?? []);
      setLoading(false);
    }

    fetchEvents();
  }, [limit, classIdsKey, includeSchoolWide]);

  const formatDate = (dateStr: string) => {
    const d = new Date(dateStr + "T00:00:00");
    return d.toLocaleDateString("en-IN", {
      day: "numeric",
      month: "short",
    });
  };

  if (loading) {
    return (
      <Card className="bg-white rounded-xl">
        <CardContent className="flex items-center justify-center py-12">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-navy-900 border-t-transparent" />
        </CardContent>
      </Card>
    );
  }

  if (events.length === 0) {
    return (
      <Card className="bg-white rounded-xl">
        <CardContent className="flex items-center justify-center py-12">
          <div className="text-center text-gray-400">
            <CalendarDays className="h-10 w-10 mx-auto mb-3 opacity-50" />
            <p className="text-sm">No upcoming events</p>
            <p className="text-xs text-gray-300 mt-1">
              Events will appear here when scheduled
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      {events.map((evt) => (
        <Card key={evt.id} className="bg-white rounded-xl">
          <CardContent className="py-3 px-4">
            <div className="flex items-center gap-3">
              <div className="flex-shrink-0 w-12 text-center">
                <p className="text-lg font-bold text-navy-900">
                  {formatDate(evt.start_date).split(" ")[0]}
                </p>
                <p className="text-xs text-gray-500 uppercase">
                  {formatDate(evt.start_date).split(" ")[1]}
                </p>
              </div>
              <div className="h-10 w-px bg-gray-200" />
              <div className="flex-1 min-w-0">
                <p className="font-medium text-navy-900 text-sm truncate">
                  {evt.title}
                </p>
                {evt.description && (
                  <p className="text-xs text-gray-500 truncate mt-0.5">
                    {evt.description}
                  </p>
                )}
              </div>
              <Badge
                className={
                  EVENT_TYPE_COLORS[evt.event_type] ?? EVENT_TYPE_COLORS.other
                }
              >
                {EVENT_TYPE_LABELS[evt.event_type] ?? evt.event_type}
              </Badge>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
