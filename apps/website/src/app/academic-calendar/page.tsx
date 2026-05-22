import { Metadata } from "next";
import { PageHeader } from "@/components/layout/PageHeader";
import { JsonLd } from "@/components/seo/JsonLd";
import { buildMetadata, breadcrumbJsonLd } from "@nkps/shared/lib/seo";
import { createClient } from "@nkps/shared/lib/supabase/server";
import type { CalendarEvent, CalendarEventType } from "@nkps/shared/types";

export const metadata: Metadata = buildMetadata({
  title: "Academic Calendar — NK Public School Jaipur",
  description:
    "Upcoming events, holidays, exams, and PTM schedule at NK Public School, Jaipur. Stay informed about important academic dates.",
  path: "/academic-calendar",
});

export const revalidate = 300;

const EVENT_TYPE_COLORS: Record<CalendarEventType, string> = {
  exam: "bg-navy-700 text-white",
  holiday: "bg-gold-500 text-navy-900",
  event: "bg-gold-600 text-white",
  pta_meeting: "bg-navy-900 text-white",
  sports: "bg-orange-600 text-white",
  cultural: "bg-pink-600 text-white",
  other: "bg-navy-600 text-white",
};

const EVENT_TYPE_LABELS: Record<CalendarEventType, string> = {
  exam: "Exam",
  holiday: "Holiday",
  event: "Event",
  pta_meeting: "PTA Meeting",
  sports: "Sports",
  cultural: "Cultural",
  other: "Other",
};

function formatDay(dateStr: string) {
  const d = new Date(dateStr + "T00:00:00");
  return {
    day: d.toLocaleDateString("en-IN", { day: "numeric" }),
    month: d.toLocaleDateString("en-IN", { month: "short" }),
    weekday: d.toLocaleDateString("en-IN", { weekday: "short" }),
  };
}

function monthKey(dateStr: string) {
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString("en-IN", { month: "long", year: "numeric" });
}

function formatRange(start: string, end: string | null) {
  if (!end || end === start) return null;
  const e = new Date(end + "T00:00:00");
  return e.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

export default async function AcademicCalendarPage() {
  const supabase = await createClient();
  const today = new Date().toISOString().split("T")[0];

  const { data } = await supabase
    .from("calendar_events")
    .select("*")
    .gte("start_date", today)
    .is("class_id", null)
    .order("start_date", { ascending: true });

  const events = (data as CalendarEvent[] | null) ?? [];

  const grouped = events.reduce<Record<string, CalendarEvent[]>>((acc, ev) => {
    const key = monthKey(ev.start_date);
    (acc[key] ||= []).push(ev);
    return acc;
  }, {});

  const monthKeys = Object.keys(grouped);

  return (
    <>
      <JsonLd
        data={breadcrumbJsonLd([
          { name: "Home", path: "/" },
          { name: "Academic Calendar", path: "/academic-calendar" },
        ])}
      />
      <PageHeader
        title="Academic Calendar"
        subtitle="Upcoming events, holidays, exams and meetings"
      />

      <section className="section-padding bg-cream-50">
        <div className="page-container max-w-5xl">
          {monthKeys.length === 0 ? (
            <div className="rounded-3xl border border-gray-100 bg-white p-12 text-center">
              <h2 className="font-heading text-2xl font-semibold text-navy-900">
                No upcoming events
              </h2>
              <p className="mt-2 text-gray-500">
                The school calendar will be updated soon. Please check back later.
              </p>
            </div>
          ) : (
            <div className="space-y-12">
              {monthKeys.map((month) => (
                <div key={month}>
                  <h2 className="font-heading text-2xl md:text-3xl font-semibold text-navy-900 mb-6">
                    {month}
                  </h2>
                  <div className="space-y-3">
                    {grouped[month].map((ev) => {
                      const day = formatDay(ev.start_date);
                      const endLabel = formatRange(ev.start_date, ev.end_date);
                      return (
                        <div
                          key={ev.id}
                          className="flex gap-4 rounded-2xl border border-gray-100 bg-white p-4 sm:p-5 hover:border-gold-500/30 hover:shadow-sm transition-all"
                        >
                          <div className="flex-shrink-0 w-16 sm:w-20 text-center rounded-xl bg-cream-50 border border-gray-100 py-2">
                            <div className="text-[10px] uppercase tracking-wider text-gray-500">
                              {day.weekday}
                            </div>
                            <div className="font-heading text-2xl sm:text-3xl font-bold text-navy-900 leading-tight">
                              {day.day}
                            </div>
                            <div className="text-[11px] uppercase tracking-wider text-gray-500">
                              {day.month}
                            </div>
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex flex-wrap items-center gap-2 mb-1">
                              <span
                                className={`inline-flex items-center text-[10px] uppercase tracking-wider font-semibold px-2 py-0.5 rounded-full ${EVENT_TYPE_COLORS[ev.event_type]}`}
                              >
                                {EVENT_TYPE_LABELS[ev.event_type]}
                              </span>
                              {endLabel && (
                                <span className="text-xs text-gray-500">
                                  through {endLabel}
                                </span>
                              )}
                            </div>
                            <h3 className="font-heading text-lg font-semibold text-navy-900">
                              {ev.title}
                            </h3>
                            {ev.description && (
                              <p className="mt-1 text-sm text-gray-600 leading-relaxed">
                                {ev.description}
                              </p>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>
    </>
  );
}
