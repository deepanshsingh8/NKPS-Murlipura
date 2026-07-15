"use client";

import Image from "next/image";
import { motion } from "framer-motion";
import {
  Music,
  Palette,
  MessageSquare,
  Brain,
  BookOpen,
  Cpu,
  Trophy,
  Target,
  CircleDot,
  Timer,
  TableProperties,
  Crown,
  Star,
} from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { PageTransition } from "@nkps/shared/components/PageTransition";
import { AnimatedSection } from "@nkps/shared/components/AnimatedSection";
import { SectionHeading } from "@nkps/shared/components/SectionHeading";
import { staggerContainer, fadeUp } from "@nkps/shared/lib/animations";
import { cn } from "@nkps/shared/lib/utils";
import type { SectionCard } from "@nkps/shared/types";

// Span layout pattern from the original masonry grid: index 1 and 2 spanned
// two rows on md+. Preserved as a positional rule so the visual rhythm of the
// section doesn't collapse when admins re-order or add cards.
const ACTIVITY_SPAN_INDEXES = new Set([1, 2]);

const activityIconMap: Record<string, React.ComponentType<{ className?: string }>> = {
  Music,
  Palette,
  MessageSquare,
  Brain,
  BookOpen,
  Cpu,
};

interface StudentLifePageProps {
  activityCards?: SectionCard[];
  eventCards?: SectionCard[];
  sportsIndoorCards?: SectionCard[];
  sportsOutdoorCards?: SectionCard[];
}

const sports = [
  { name: "Cricket", icon: Trophy },
  { name: "Football", icon: Target },
  { name: "Basketball", icon: CircleDot },
  { name: "Athletics", icon: Timer },
  { name: "Table Tennis", icon: TableProperties },
  { name: "Chess", icon: Crown },
];

export function StudentLifeContent({
  activityCards,
  eventCards,
  sportsIndoorCards,
  sportsOutdoorCards,
}: StudentLifePageProps = {}) {
  // CMS-managed Indoor/Outdoor sports (title-only cards). When an editor has
  // added any, they replace the curated fallback list below, grouped by type.
  const sportsGroups = [
    { label: "Indoor", names: (sportsIndoorCards ?? []).map((c) => c.title || "").filter(Boolean) },
    { label: "Outdoor", names: (sportsOutdoorCards ?? []).map((c) => c.title || "").filter(Boolean) },
  ].filter((g) => g.names.length > 0);
  const hasCmsSports = sportsGroups.length > 0;
  // Single source of truth: section_cards. Defaults are seeded as is_default
  // rows (migration 057) for both `activities` and `annual_events`.
  const activities = (activityCards ?? []).map((c, i) => ({
    id: c.id,
    icon: activityIconMap[c.icon || ""] || Cpu,
    title: c.title || "",
    description: c.description || "",
    image: c.image_url || "/images/gallery/st1.jpg",
    span: ACTIVITY_SPAN_INDEXES.has(i),
  }));

  const allEvents = (eventCards ?? []).map((c) => ({
    id: c.id,
    season: c.season || "",
    title: c.title || "",
    description: c.description || "",
  }));

  return (
    <PageTransition>
      <PageHeader title="Student Life" subtitle="Beyond the Classroom" />

      {/* Activities — Masonry-like Grid */}
      {activities.length > 0 && (
      <section className="py-20 px-6">
        <div className="mx-auto max-w-6xl">
          <AnimatedSection>
            <SectionHeading
              title="Activities & Clubs"
              subtitle="Discover your passion through our diverse range of extracurricular activities"
              light
            />
          </AnimatedSection>

          <motion.div
            variants={staggerContainer}
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true, margin: "-100px" }}
            className="mt-14 grid auto-rows-[250px] sm:auto-rows-[200px] grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-3"
          >
            {activities.map((activity) => (
              <motion.div
                key={activity.id}
                variants={fadeUp}
                className={cn(
                  "group relative overflow-hidden rounded-3xl",
                  activity.span && "md:row-span-2"
                )}
              >
                <Image
                  src={activity.image}
                  alt={activity.title}
                  fill
                  className="object-cover transition-transform duration-700 group-hover:scale-110"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-navy-950/90 via-navy-950/40 to-transparent transition-all duration-500 group-hover:from-navy-950/95" />

                {/* Icon circle */}
                <div className="absolute left-5 top-5 flex h-11 w-11 items-center justify-center rounded-full bg-white/10 backdrop-blur-md transition-all duration-300 group-hover:bg-white/20">
                  <activity.icon className="h-5 w-5 text-white" />
                </div>

                {/* Content at bottom */}
                <div className="absolute inset-x-0 bottom-0 p-6">
                  <h3 className="font-heading text-xl font-bold text-white">
                    {activity.title}
                  </h3>
                  <p className="mt-1.5 text-sm leading-relaxed text-gray-200 opacity-0 transition-all duration-500 group-hover:opacity-100">
                    {activity.description}
                  </p>
                </div>
              </motion.div>
            ))}
          </motion.div>
        </div>
      </section>
      )}

      {/* Sports & Athletics */}
      <section className="py-20 px-6">
        <div className="mx-auto max-w-4xl">
          <AnimatedSection>
            <SectionHeading
              title="Sports & Athletics"
              subtitle="Building teamwork, discipline and physical fitness through sports"
              light
            />
          </AnimatedSection>

          <AnimatedSection delay={0.15}>
            <p className="mx-auto mt-6 max-w-2xl text-center leading-relaxed text-chalk-dim">
              Our school provides excellent sports facilities and professional
              coaching to help students excel in various sporting disciplines.
              Regular inter-house and inter-school competitions encourage healthy
              competition and sportsmanship.
            </p>
          </AnimatedSection>

          {hasCmsSports ? (
            <div className="mt-10 space-y-8">
              {sportsGroups.map((group) => (
                <div key={group.label}>
                  <h3 className="mb-4 text-center font-heading text-sm font-semibold uppercase tracking-wider text-chalk-gold">
                    {group.label}
                  </h3>
                  <motion.div
                    variants={staggerContainer}
                    initial="hidden"
                    whileInView="visible"
                    viewport={{ once: true, margin: "-60px" }}
                    className="flex flex-wrap items-center justify-center gap-4"
                  >
                    {group.names.map((name) => (
                      <motion.div
                        key={name}
                        variants={fadeUp}
                        className="group flex cursor-default items-center gap-2.5 rounded-full border border-chalk/20 bg-white/[0.04] px-6 py-3 shadow-sm transition-all duration-300 hover:border-gold-500/40 hover:bg-white/[0.06]"
                      >
                        <CircleDot className="h-4.5 w-4.5 text-chalk-dim transition-colors duration-300 group-hover:text-chalk-gold" />
                        <span className="text-sm font-semibold text-chalk">
                          {name}
                        </span>
                      </motion.div>
                    ))}
                  </motion.div>
                </div>
              ))}
            </div>
          ) : (
            <motion.div
              variants={staggerContainer}
              initial="hidden"
              whileInView="visible"
              viewport={{ once: true, margin: "-60px" }}
              className="mt-10 flex flex-wrap items-center justify-center gap-4"
            >
              {sports.map((sport) => (
                <motion.div
                  key={sport.name}
                  variants={fadeUp}
                  className="group flex cursor-default items-center gap-2.5 rounded-full border border-chalk/20 bg-white/[0.04] px-6 py-3 shadow-sm transition-all duration-300 hover:border-gold-500/40 hover:bg-white/[0.06]"
                >
                  <sport.icon className="h-4.5 w-4.5 text-chalk-dim transition-colors duration-300 group-hover:text-chalk-gold" />
                  <span className="text-sm font-semibold text-chalk">
                    {sport.name}
                  </span>
                </motion.div>
              ))}
            </motion.div>
          )}
        </div>
      </section>

      {/* Annual Events — Timeline Style */}
      {allEvents.length > 0 && (
      <section className="py-20 px-6">
        <div className="mx-auto max-w-4xl">
          <AnimatedSection>
            <SectionHeading
              title="Annual Events"
              subtitle="Memorable celebrations that bring our school community together"
              light
            />
          </AnimatedSection>

          <div className="mt-14 space-y-6">
            {allEvents.map((event, index) => (
              <AnimatedSection key={event.id} delay={index * 0.12}>
                <div className="group flex flex-col gap-5 rounded-2xl border border-chalk/20 bg-white/[0.04] p-6 shadow-sm transition-all duration-300 hover:border-gold-500/40 hover:bg-white/[0.06] hover:shadow-lg sm:flex-row sm:items-start">
                  {/* Season Badge */}
                  <div className="flex h-16 w-16 shrink-0 flex-col items-center justify-center rounded-2xl bg-gradient-to-br from-gold-400 to-gold-600 shadow-md transition-transform duration-300 group-hover:scale-105">
                    <Star className="h-5 w-5 text-white" />
                    <span className="mt-0.5 text-[10px] font-bold uppercase tracking-wider text-white/90">
                      {event.season}
                    </span>
                  </div>

                  {/* Content */}
                  <div className="flex-1">
                    <h3 className="font-heading text-lg font-bold text-chalk">
                      {event.title}
                    </h3>
                    <p className="mt-1.5 leading-relaxed text-chalk-dim">
                      {event.description}
                    </p>
                  </div>
                </div>
              </AnimatedSection>
            ))}
          </div>
        </div>
      </section>
      )}
    </PageTransition>
  );
}
