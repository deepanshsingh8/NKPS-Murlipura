"use client";

import { motion } from "framer-motion";
import { Eye, Target } from "lucide-react";
import { SectionHeading } from "@nkps/shared/components/SectionHeading";
import { staggerContainer, fadeUp } from "@nkps/shared/lib/animations";
import { SCHOOL } from "@nkps/shared/lib/constants";

export function VisionMission() {
  return (
    <section className="section-padding">
      <div className="page-container">
        <SectionHeading
          label="What Drives Us"
          title="Our Vision & Mission"
          light
        />

        <motion.div
          variants={staggerContainer}
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true }}
          className="grid grid-cols-1 md:grid-cols-2 gap-8 mt-12 max-w-5xl mx-auto"
        >
          {/* Vision */}
          <motion.div
            variants={fadeUp}
            whileHover={{ y: -4 }}
            transition={{ type: "spring", stiffness: 300, damping: 20 }}
            className="p-8 h-full rounded-2xl bg-white/[0.04] border border-chalk/20 hover:border-gold-500/40 hover:bg-white/[0.06] transition-all duration-300"
          >
            <div className="flex items-center gap-4 mb-5">
              <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-gold-500/10 text-chalk-gold">
                <Eye className="h-7 w-7" />
              </div>
              <h3 className="font-heading text-2xl font-bold text-chalk">
                Our Vision
              </h3>
            </div>
            <p className="text-chalk-dim leading-relaxed">{SCHOOL.vision}</p>
          </motion.div>

          {/* Mission */}
          <motion.div
            variants={fadeUp}
            whileHover={{ y: -4 }}
            transition={{ type: "spring", stiffness: 300, damping: 20 }}
            className="p-8 h-full rounded-2xl bg-white/[0.04] border border-chalk/20 hover:border-gold-500/40 hover:bg-white/[0.06] transition-all duration-300"
          >
            <div className="flex items-center gap-4 mb-5">
              <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-white/[0.06] text-chalk">
                <Target className="h-7 w-7" />
              </div>
              <h3 className="font-heading text-2xl font-bold text-chalk">
                Our Mission
              </h3>
            </div>
            <p className="text-chalk-dim leading-relaxed">{SCHOOL.mission}</p>
          </motion.div>
        </motion.div>
      </div>
    </section>
  );
}
