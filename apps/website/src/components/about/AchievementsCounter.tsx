"use client";

import { SectionHeading } from "@nkps/shared/components/SectionHeading";
import { CounterAnimation } from "@nkps/shared/components/CounterAnimation";
import { SCHOOL } from "@nkps/shared/lib/constants";

export function AchievementsCounter() {
  return (
    <section className="py-20 bg-navy-900">
      <div className="page-container">
        <SectionHeading title="Our Achievements at a Glance" light />

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 sm:gap-8 mt-12">
          {SCHOOL.achievementStats.map((stat) => (
            <CounterAnimation
              key={stat.label}
              end={stat.value}
              suffix={stat.suffix}
              label={stat.label}
              light
            />
          ))}
        </div>
      </div>
    </section>
  );
}
