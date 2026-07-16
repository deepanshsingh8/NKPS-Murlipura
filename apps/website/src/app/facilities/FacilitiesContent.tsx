"use client";

import Image from "next/image";
import { motion } from "framer-motion";
import {
  Monitor,
  FlaskConical,
  Laptop,
  BookOpen,
  Trophy,
  Theater,
  Gamepad2,
  Bus,
  CheckCircle,
} from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { PageTransition } from "@nkps/shared/components/PageTransition";
import { AnimatedSection } from "@nkps/shared/components/AnimatedSection";
import { SectionHeading } from "@nkps/shared/components/SectionHeading";
import { staggerContainer, fadeUp } from "@nkps/shared/lib/animations";
import { cn } from "@nkps/shared/lib/utils";
import type { SectionCard } from "@nkps/shared/types";

const iconMap: Record<string, React.ComponentType<{ className?: string }>> = {
  Monitor,
  FlaskConical,
  Laptop,
  BookOpen,
  Trophy,
  Theater,
  Gamepad2,
  Bus,
};

// On-brand gradient treatments for cards that have no uploaded photo yet.
// Cycled by card index so adjacent cards never look identical.
const graphicGradients = [
  "from-navy-900 via-navy-800 to-blue-700",
  "from-blue-800 via-navy-800 to-navy-900",
  "from-navy-800 via-blue-700 to-navy-900",
  "from-blue-700 via-navy-800 to-navy-950",
];

const highlights = [
  {
    title: "CCTV Surveillance",
    description: "24/7 monitoring across all campus areas for complete safety",
  },
  {
    title: "Fire Safety Systems",
    description: "Modern fire detection and suppression equipment installed",
  },
  {
    title: "Solar Power",
    description: "Sustainable energy powering our campus infrastructure",
  },
  {
    title: "RO Water Purifiers",
    description: "Clean and safe drinking water available at every floor",
  },
  {
    title: "First Aid Room",
    description: "Fully equipped medical room with trained staff on standby",
  },
  {
    title: "Spacious Parking",
    description: "Organized parking facility for staff and visitor vehicles",
  },
];

interface FacilitiesContentProps {
  heroImage: string;
  cards?: SectionCard[];
}

export function FacilitiesContent({ heroImage, cards }: FacilitiesContentProps) {
  // Single source of truth: section_cards. Defaults are seeded as is_default
  // rows (migration 058).
  const facilities = (cards ?? []).map((c) => ({
    id: c.id,
    title: c.title || "",
    description: c.description || "",
    icon: c.icon || "Monitor",
    // Keep null when no photo is set so we render the branded graphic instead
    // of falling every card back to the same placeholder image.
    image: c.image_url || null,
  }));
  return (
    <PageTransition>
      <PageHeader
        title="Our Facilities"
        subtitle="World-Class Infrastructure for Holistic Development"
      />

      {/* Featured Hero Banner */}
      <section className="relative h-[40vh] w-full overflow-hidden">
        <Image
          src={heroImage}
          alt="NK Public School Campus Building"
          fill
          className="object-cover"
          priority
        />
        <div className="absolute inset-0 bg-gradient-to-r from-navy-950/80 via-navy-900/60 to-navy-950/80" />
        <div className="absolute inset-0 flex flex-col items-center justify-center px-6 text-center">
          <h2 className="font-heading text-3xl font-bold text-white md:text-4xl">
            Explore Our Campus
          </h2>
          <p className="mt-3 max-w-xl text-gray-200">
            A purpose-built environment where learning meets innovation
          </p>
        </div>
      </section>

      {/* Facilities Grid — Alternating Image Cards */}
      {facilities.length > 0 && (
      <section className="py-20 px-6">
        <div className="mx-auto max-w-6xl">
          <AnimatedSection>
            <SectionHeading
              title="Campus Facilities"
              subtitle="Modern amenities designed to enhance every aspect of student life"
              light
            />
          </AnimatedSection>

          <motion.div
            variants={staggerContainer}
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true, margin: "-100px" }}
            className="mt-14 grid grid-cols-1 gap-8 lg:grid-cols-2"
          >
            {facilities.map((facility, index) => {
              const Icon = iconMap[facility.icon] || Monitor;
              const image = facility.image;
              return (
                <motion.div
                  key={facility.id}
                  variants={fadeUp}
                  className="group"
                >
                  <div
                    className={cn(
                      "flex overflow-hidden rounded-3xl bg-white shadow-[0_14px_28px_-14px_rgba(0,0,0,0.55)] transition-shadow duration-500 hover:shadow-xl",
                      "flex-col sm:flex-row",
                      index % 2 === 1 && "sm:flex-row-reverse"
                    )}
                  >
                    {/* Image */}
                    <div className="relative h-56 w-full shrink-0 overflow-hidden sm:h-auto sm:w-2/5">
                      {image ? (
                        <>
                          <Image
                            src={image}
                            alt={facility.title}
                            fill
                            className="object-cover transition-transform duration-700 group-hover:scale-110"
                          />
                          <div className="absolute inset-0 bg-navy-950/20 transition-opacity duration-500 group-hover:opacity-0" />
                        </>
                      ) : (
                        /* Branded graphic fallback — used until a photo is uploaded */
                        <div
                          className={cn(
                            "absolute inset-0 bg-gradient-to-br",
                            graphicGradients[index % graphicGradients.length]
                          )}
                        >
                          <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_40%,rgba(212,168,67,0.18),transparent_65%)]" />
                          {Icon && (
                            <Icon className="absolute left-1/2 top-1/2 h-20 w-20 -translate-x-1/2 -translate-y-1/2 text-white/10 transition-transform duration-700 group-hover:scale-110" />
                          )}
                        </div>
                      )}
                    </div>

                    {/* Content */}
                    <div className="flex flex-1 flex-col justify-center p-8">
                      <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-blue-600/10 transition-colors duration-300 group-hover:bg-blue-600/20">
                        {Icon && (
                          <Icon className="h-6 w-6 text-blue-600" />
                        )}
                      </div>
                      <h3 className="font-heading text-xl font-bold text-navy-900">
                        {facility.title}
                      </h3>
                      <p className="mt-2 leading-relaxed text-gray-600">
                        {facility.description}
                      </p>
                    </div>
                  </div>
                </motion.div>
              );
            })}
          </motion.div>
        </div>
      </section>
      )}

      {/* Infrastructure Highlights */}
      <section className="bg-navy-900 py-20 px-6">
        <div className="mx-auto max-w-5xl">
          <AnimatedSection>
            <SectionHeading
              title="Infrastructure Highlights"
              subtitle="Safety, sustainability and comfort at every corner"
              light
            />
          </AnimatedSection>

          <motion.div
            variants={staggerContainer}
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true, margin: "-80px" }}
            className="mt-14 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3"
          >
            {highlights.map((item) => (
              <motion.div
                key={item.title}
                variants={fadeUp}
                className="group flex items-start gap-4 rounded-2xl border border-white/10 bg-white/5 p-6 backdrop-blur-sm transition-all duration-300 hover:border-gold-500/30 hover:bg-white/10"
              >
                <CheckCircle className="mt-0.5 h-6 w-6 shrink-0 text-gold-500" />
                <div>
                  <h4 className="font-heading font-semibold text-white">
                    {item.title}
                  </h4>
                  <p className="mt-1 text-sm leading-relaxed text-gray-400">
                    {item.description}
                  </p>
                </div>
              </motion.div>
            ))}
          </motion.div>
        </div>
      </section>
    </PageTransition>
  );
}
