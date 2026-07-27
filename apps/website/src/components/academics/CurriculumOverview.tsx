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
    range: "Nursery to Class II \u00b7 5 years",
    subjects: [
      "English",
      "Hindi",
      "Numeracy",
      "EVS",
      "Art & Craft",
      "Play-based Learning",
    ],
    accent: "bg-blue-600",
  },
  {
    tab: "Preparatory (III\u2013V)",
    title: "Preparatory Stage",
    range: "Class III to V \u00b7 3 years",
    subjects: [
      "English",
      "Hindi",
      "Mathematics",
      "EVS",
      "Computer Science",
      "Art & Craft",
    ],
    accent: "bg-gold-500",
  },
  {
    tab: "Middle (VI\u2013VIII)",
    title: "Middle Stage",
    range: "Class VI to VIII \u00b7 3 years",
    subjects: [
      "English",
      "Hindi",
      "Mathematics",
      "Science",
      "Social Science",
      "Sanskrit",
      "Computer Science",
    ],
    accent: "bg-blue-600",
  },
  {
    tab: "Secondary (IX\u2013XII)",
    title: "Secondary Stage",
    range: "Class IX to XII \u00b7 4 years",
    subjects: [
      "English",
      "Hindi",
      "Mathematics",
      "Science",
      "Social Science",
      "Physics",
      "Chemistry",
      "Biology",
      "Accountancy",
      "Economics",
      "Business Studies",
      "Computer Science",
    ],
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
                    <h3 className="font-heading text-2xl font-bold text-chalk">
                      {levels[activeTab].title}
                    </h3>
                    <p className="text-chalk-faint text-sm mt-1">
                      {levels[activeTab].range}
                    </p>

                    {/* Subject badges */}
                    <div className="flex flex-wrap gap-3 mt-6">
                      {levels[activeTab].subjects.map((subject, idx) => (
                        <motion.span
                          key={subject}
                          initial={{ opacity: 0, scale: 0.9 }}
                          animate={{ opacity: 1, scale: 1 }}
                          transition={{
                            duration: 0.25,
                            delay: idx * 0.04,
                            ease: "easeOut",
                          }}
                          className="bg-white/[0.06] text-chalk-dim border border-chalk/15 rounded-full px-4 py-2 text-sm font-medium"
                        >
                          {subject}
                        </motion.span>
                      ))}
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
