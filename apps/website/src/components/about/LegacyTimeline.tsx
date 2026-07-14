"use client";

import { AnimatedSection } from "@nkps/shared/components/AnimatedSection";
import { SectionHeading } from "@nkps/shared/components/SectionHeading";
import type { SectionCard } from "@nkps/shared/types";

interface LegacyTimelineProps {
  cards?: SectionCard[];
}

export function LegacyTimeline({ cards }: LegacyTimelineProps = {}) {
  // Single source of truth: section_cards. Defaults are seeded as is_default
  // rows (migration 056).
  const allMilestones = (cards ?? []).map((c) => ({
    id: c.id,
    year: c.year || "",
    title: c.title || "",
    description: c.description || "",
  }));

  if (allMilestones.length === 0) return null;
  return (
    <section className="section-padding">
      <div className="page-container">
        <SectionHeading title="Our Legacy" light />

        <div className="relative mt-12 max-w-3xl mx-auto">
          {/* Vertical line */}
          <div className="absolute left-4 md:left-6 top-0 bottom-0 w-0.5 bg-gold-500/30" />

          {allMilestones.map((milestone, index) => (
            <AnimatedSection key={milestone.id}>
              <div
                className="relative pl-14 md:pl-20 pb-12 last:pb-0"
                style={{ transitionDelay: `${index * 100}ms` }}
              >
                {/* Dot */}
                <div className="absolute left-2 md:left-4 top-1 w-5 h-5 rounded-full bg-gold-500 border-4 border-board z-10" />

                {/* Year badge */}
                <span className="inline-block bg-gold-500 text-navy-900 text-sm font-semibold px-3 py-1 rounded-full mb-2">
                  {milestone.year}
                </span>

                <h3 className="font-heading text-xl font-bold text-chalk mt-1">
                  {milestone.title}
                </h3>
                <p className="text-chalk-dim mt-1">{milestone.description}</p>
              </div>
            </AnimatedSection>
          ))}
        </div>
      </div>
    </section>
  );
}
