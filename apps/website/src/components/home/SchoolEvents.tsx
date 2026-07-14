"use client";

import { useEffect, useState } from "react";
import { createClient } from "@nkps/shared/lib/supabase/client";
import { motion } from "framer-motion";
import { SectionHeading } from "@nkps/shared/components/SectionHeading";
import { AnimatedSection } from "@nkps/shared/components/AnimatedSection";
import { staggerContainer, fadeUp } from "@nkps/shared/lib/animations";
import type { CalendarEvent, CalendarEventType } from "@nkps/shared/types";

const EVENT_TYPE_COLORS: Record<CalendarEventType, string> = {
  exam: "bg-navy-700",
  holiday: "bg-gold-500",
  event: "bg-gold-600",
  pta_meeting: "bg-navy-900",
  sports: "bg-orange-600",
  cultural: "bg-pink-600",
  other: "bg-navy-600",
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

export function SchoolEvents() {
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    async function fetchEvents() {
      const supabase = createClient();
      const today = new Date().toISOString().split("T")[0];

      const { data } = await supabase
        .from("calendar_events")
        .select("*")
        .gte("start_date", today)
        .is("class_id", null) // Only school-wide events
        .order("start_date", { ascending: true })
        .limit(6);

      setEvents((data as CalendarEvent[]) ?? []);
      setLoaded(true);
    }

    fetchEvents();
  }, []);

  // Don't render section if no events
  if (loaded && events.length === 0) return null;
  if (!loaded) return null;

  const formatDate = (dateStr: string) => {
    const d = new Date(dateStr + "T00:00:00");
    return {
      day: d.toLocaleDateString("en-IN", { day: "numeric" }),
      month: d.toLocaleDateString("en-IN", { month: "short" }),
      weekday: d.toLocaleDateString("en-IN", { weekday: "short" }),
    };
  };

  return (
    <section className="section-padding">
      <div className="page-container">
        <AnimatedSection>
          <SectionHeading
            label="School Calendar"
            title="Upcoming Events"
            subtitle="Stay updated with the latest happenings at NKPS"
            light
          />
        </AnimatedSection>

        <motion.div
          variants={staggerContainer}
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: "-50px" }}
          className="mt-12 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5"
        >
          {events.map((evt) => {
            const date = formatDate(evt.start_date);
            return (
              <motion.div
                key={evt.id}
                variants={fadeUp}
                whileHover={{ y: -4 }}
                transition={{ type: "spring", stiffness: 300, damping: 25 }}
                className="group bg-white/[0.04] rounded-2xl border border-chalk/20 p-5 hover:bg-white/[0.06] hover:border-gold-500/40 transition-all duration-500 cursor-default"
              >
                <div className="flex items-start gap-4">
                  <div className="flex-shrink-0 w-14 text-center bg-white/[0.06] rounded-xl py-2.5 group-hover:bg-gold-500/15 transition-colors duration-500">
                    <p className="text-xl font-bold text-chalk group-hover:text-chalk-gold transition-colors duration-300">{date.day}</p>
                    <p className="text-xs text-chalk-faint uppercase font-medium">
                      {date.month}
                    </p>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span
                        className={`inline-block w-2 h-2 rounded-full ${
                          EVENT_TYPE_COLORS[evt.event_type] ??
                          EVENT_TYPE_COLORS.other
                        }`}
                      />
                      <span className="text-xs font-medium text-chalk-faint">
                        {EVENT_TYPE_LABELS[evt.event_type] ?? evt.event_type}
                      </span>
                    </div>
                    <h3 className="text-chalk text-base leading-snug">
                      {evt.title}
                    </h3>
                    {evt.description && (
                      <p className="text-xs text-chalk-dim mt-1 line-clamp-2">
                        {evt.description}
                      </p>
                    )}
                  </div>
                </div>
              </motion.div>
            );
          })}
        </motion.div>
      </div>
    </section>
  );
}
