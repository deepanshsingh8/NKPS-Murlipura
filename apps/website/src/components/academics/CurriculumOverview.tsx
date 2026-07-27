"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@nkps/shared/lib/utils";
import { SectionHeading } from "@nkps/shared/components/SectionHeading";

// Structured on the National Education Policy (NEP 2020) 5+3+3+4 framework:
// Foundational (5 yrs), Preparatory (3 yrs), Middle (3 yrs) and Secondary (4 yrs).
const levels = [
  {
    tab: "Foundational (Nursery\u2013II)",
    title: "Foundational Stage",
    duration: "5 years",
    ages: "3 to 8 years",
    classes: "3 years of preschool + Class I & II",
    focus:
      "Play-based, activity-based learning and multi-level early childhood care.",
    accent: "bg-blue-600",
  },
  {
    tab: "Preparatory (III\u2013V)",
    title: "Preparatory Stage",
    duration: "3 years",
    ages: "8 to 11 years",
    classes: "Class III, IV and V",
    focus:
      "Play, discovery and interactive classroom learning, building foundational numeracy and literacy.",
    accent: "bg-gold-500",
  },
  {
    tab: "Middle (VI\u2013VIII)",
    title: "Middle Stage",
    duration: "3 years",
    ages: "11 to 14 years",
    classes: "Class VI, VII and VIII",
    focus:
      "Experiential learning in the sciences, mathematics, arts, social sciences and humanities, with an introduction to vocational crafts and coding.",
    accent: "bg-blue-600",
  },
  {
    tab: "Secondary (IX\u2013XII)",
    title: "Secondary Stage",
    duration: "4 years",
    ages: "14 to 18 years",
    classes: "Class IX to XII (two phases: IX\u2013X and XI\u2013XII)",
    focus:
      "Multidisciplinary study, critical thinking and flexibility, with no rigid separation between the science and commerce streams.",
    accent: "bg-gold-500",
  },
];

export function CurriculumOverview() {
  const [activeTab, setActiveTab] = useState(0);

  return (
    <section className="section-padding">
      <div className="page-container">
        <SectionHeading
          title="Our Curriculum"
          subtitle="State Board affiliated comprehensive education from Nursery to Class XII, structured on the NEP 5+3+3+4 framework"
          light
        />

        {/* Tab buttons */}
        <div className="mt-12 flex overflow-x-auto gap-3 pb-2 [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">
          {levels.map((level, i) => (
            <button
              key={level.tab}
              onClick={() => setActiveTab(i)}
              className={cn(
                "whitespace-nowrap rounded-full px-6 py-3 text-sm font-semibold transition-all duration-300 cursor-pointer shrink-0",
                i === activeTab
                  ? "bg-navy-900 text-white shadow-lg shadow-navy-900/20 border border-gold-500/30"
                  : "bg-white/[0.04] text-chalk border border-chalk/20 hover:border-gold-500/40 hover:bg-white/[0.07]"
              )}
            >
              {level.tab}
            </button>
          ))}
        </div>

        {/* Tab content */}
        <div className="mt-8">
          <AnimatePresence mode="wait">
            <motion.div
              key={activeTab}
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -16 }}
              transition={{ duration: 0.35, ease: "easeInOut" }}
            >
              <div className="bg-white/[0.04] rounded-3xl p-5 sm:p-8 md:p-10 border border-chalk/20 shadow-[0_14px_28px_-14px_rgba(0,0,0,0.55)]">
                <div className="flex gap-4 sm:gap-6 md:gap-8">
                  {/* Accent bar */}
                  <div
                    className={cn(
                      "w-1 rounded-full shrink-0",
                      levels[activeTab].accent
                    )}
                  />

                  {/* Content */}
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-3">
                      <h3 className="font-heading text-2xl font-bold text-chalk">
                        {levels[activeTab].title}
                      </h3>
                      <span className="rounded-full border border-gold-500/30 bg-gold-500/15 px-3 py-1 text-xs font-semibold text-chalk-gold">
                        {levels[activeTab].duration}
                      </span>
                    </div>

                    {/* Classes + Ages */}
                    <div className="mt-6 grid gap-4 sm:grid-cols-2">
                      <div>
                        <p className="text-chalk-faint text-xs font-semibold uppercase tracking-wider">
                          Classes
                        </p>
                        <p className="text-chalk-dim text-sm mt-1">
                          {levels[activeTab].classes}
                        </p>
                      </div>
                      <div>
                        <p className="text-chalk-faint text-xs font-semibold uppercase tracking-wider">
                          Ages
                        </p>
                        <p className="text-chalk-dim text-sm mt-1">
                          {levels[activeTab].ages}
                        </p>
                      </div>
                    </div>

                    {/* Focus */}
                    <div className="mt-5">
                      <p className="text-chalk-faint text-xs font-semibold uppercase tracking-wider">
                        Focus
                      </p>
                      <p className="text-chalk-dim text-sm mt-1 leading-relaxed">
                        {levels[activeTab].focus}
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </motion.div>
          </AnimatePresence>
        </div>
      </div>
    </section>
  );
}
