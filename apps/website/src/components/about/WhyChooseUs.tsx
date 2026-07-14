"use client";

import { motion } from "framer-motion";
import { Award, BookOpen, Monitor, Trophy } from "lucide-react";
import { SectionHeading } from "@nkps/shared/components/SectionHeading";
import { staggerContainer, fadeUp } from "@nkps/shared/lib/animations";
import type { SectionCard } from "@nkps/shared/types";

const iconMap: Record<string, React.ComponentType<{ className?: string }>> = {
  Award,
  BookOpen,
  Monitor,
  Trophy,
};

interface WhyChooseUsProps {
  cards?: SectionCard[];
}

export function WhyChooseUs({ cards }: WhyChooseUsProps = {}) {
  // Single source of truth: section_cards. Defaults are seeded as is_default
  // rows (migration 055).
  const allFeatures = (cards ?? []).map((c) => ({
    id: c.id,
    icon: iconMap[c.icon || ""] || Award,
    title: c.title || "",
    desc: c.description || "",
  }));

  if (allFeatures.length === 0) return null;
  return (
    <section className="section-padding">
      <div className="page-container">
        <SectionHeading
          title="Why Choose Us?"
          subtitle="What sets NK Public School apart from the rest"
          light
        />

        <motion.div
          variants={staggerContainer}
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true }}
          className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8 mt-12"
        >
          {allFeatures.map((feature) => (
            <motion.div
              key={feature.id}
              variants={fadeUp}
              whileHover={{ y: -4 }}
              transition={{ type: "spring", stiffness: 300, damping: 20 }}
              className="p-8 text-center rounded-2xl bg-white/[0.04] border border-chalk/20 hover:border-gold-500/40 hover:bg-white/[0.06] transition-all duration-300"
            >
              <div className="bg-gold-500/10 w-16 h-16 rounded-2xl flex items-center justify-center mx-auto">
                <feature.icon className="w-8 h-8 text-chalk-gold" />
              </div>
              <h3 className="font-heading text-lg font-semibold text-chalk mt-4">
                {feature.title}
              </h3>
              <p className="text-chalk-dim text-sm mt-2">{feature.desc}</p>
            </motion.div>
          ))}
        </motion.div>
      </div>
    </section>
  );
}
