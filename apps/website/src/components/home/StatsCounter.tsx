"use client";

import Image from "next/image";
import { motion } from "framer-motion";
import { Users, CalendarDays, GraduationCap, Building2, Award, BookOpen } from "lucide-react";
import { SCHOOL } from "@nkps/shared/lib/constants";
import { CounterAnimation } from "@nkps/shared/components/CounterAnimation";
import { SectionHeading } from "@nkps/shared/components/SectionHeading";
import { staggerContainer, fadeUp } from "@nkps/shared/lib/animations";

const statIcons = [Users, CalendarDays, GraduationCap, Building2, Award, BookOpen];

interface StatsCounterProps {
  backgroundImage?: string;
}

export function StatsCounter({ backgroundImage }: StatsCounterProps = {}) {
  return (
    <section className="relative bg-navy-900 overflow-hidden">
      {/* Background image */}
      <div className="absolute inset-0">
        <Image
          src={backgroundImage || "/images/gallery/g10.jpg"}
          alt=""
          fill
          className="object-cover"
          sizes="100vw"
        />
        <div className="absolute inset-0 bg-navy-950/88" />
      </div>

      <div className="page-container relative z-10 py-24 px-4">
        <SectionHeading
          label="By the Numbers"
          title="NK Public School in Numbers"
          light
        />

        {/* Stats grid — glass cards with glow */}
        <motion.div
          variants={staggerContainer}
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: "-80px" }}
          className="grid grid-cols-2 md:grid-cols-4 gap-4 md:gap-6 mt-16"
        >
          {SCHOOL.stats.map((stat, i) => {
            const Icon = statIcons[i] || Users;
            return (
              <motion.div
                key={stat.label}
                variants={fadeUp}
                whileHover={{ y: -4, transition: { duration: 0.3 } }}
                className="group relative rounded-2xl bg-white/[0.04] border border-white/[0.08] backdrop-blur-sm p-4 sm:p-6 text-center transition-all duration-500 hover:bg-white/[0.08] hover:border-gold-500/20 cursor-default"
              >
                {/* Glow effect on hover */}
                <div className="absolute inset-0 rounded-2xl opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none"
                  style={{ boxShadow: "inset 0 1px 0 rgba(212,168,67,0.15), 0 0 30px rgba(212,168,67,0.06)" }}
                />

                <div className="relative">
                  <div className="w-10 h-10 sm:w-12 sm:h-12 mx-auto rounded-xl bg-gold-500/10 flex items-center justify-center mb-3 sm:mb-4 group-hover:bg-gold-500/20 transition-colors duration-500">
                    <Icon className="w-5 h-5 text-gold-400 transition-transform duration-500 group-hover:scale-110" />
                  </div>
                  <CounterAnimation
                    end={stat.value}
                    suffix={stat.suffix}
                    label={stat.label}
                    display={"display" in stat ? stat.display : undefined}
                    light
                  />
                </div>
              </motion.div>
            );
          })}
        </motion.div>
      </div>
    </section>
  );
}
