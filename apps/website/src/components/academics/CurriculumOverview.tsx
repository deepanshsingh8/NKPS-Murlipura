"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@nkps/shared/lib/utils";
import { SectionHeading } from "@nkps/shared/components/SectionHeading";

const levels = [
  {
    tab: "Primary (I\u2013V)",
    title: "Primary School",
    range: "Class I to V",
    subjects: [
      "English",
      "Hindi",
      "Mathematics",
      "EVS",
      "Computer Science",
      "Art & Craft",
    ],
    accent: "bg-blue-600",
  },
  {
    tab: "Middle (VI\u2013VIII)",
    title: "Middle School",
    range: "Class VI to VIII",
    subjects: [
      "English",
      "Hindi",
      "Mathematics",
      "Science",
      "Social Science",
      "Sanskrit",
      "Computer Science",
    ],
    accent: "bg-gold-500",
  },
  {
    tab: "Secondary (IX\u2013X)",
    title: "Secondary School",
    range: "Class IX to X",
    subjects: [
      "English",
      "Hindi",
      "Mathematics",
      "Science",
      "Social Science",
      "Information Technology",
    ],
    accent: "bg-blue-600",
  },
  {
    tab: "Sr. Secondary (XI\u2013XII)",
    title: "Senior Secondary School",
    range: "Class XI to XII",
    subjects: [
      "Physics",
      "Chemistry",
      "Biology",
      "Mathematics",
      "Accountancy",
      "Economics",
      "Business Studies",
      "English",
      "Computer Science",
    ],
    accent: "bg-gold-500",
  },
];

export function CurriculumOverview() {
  const [activeTab, setActiveTab] = useState(0);

  return (
    <section className="section-padding bg-cream-50">
      <div className="page-container">
        <SectionHeading
          title="Our Curriculum"
          subtitle="CBSE-affiliated comprehensive education from Nursery to Class XII"
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
                  ? "bg-navy-900 text-white shadow-lg shadow-navy-900/20"
                  : "bg-gray-100 text-navy-900 hover:bg-gray-200"
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
              <div className="bg-white rounded-3xl p-5 sm:p-8 md:p-10 border border-gray-100 shadow-sm">
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
                    <h3 className="font-heading text-2xl font-bold text-navy-900">
                      {levels[activeTab].title}
                    </h3>
                    <p className="text-gray-500 text-sm mt-1">
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
                          className="bg-gray-100 text-navy-700 rounded-full px-4 py-2 text-sm font-medium"
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
