"use client";

import Image from "next/image";
import Link from "next/link";
import { motion } from "framer-motion";
import { Monitor, FlaskConical, Laptop, BookOpen, ArrowRight } from "lucide-react";
import { SectionHeading } from "@nkps/shared/components/SectionHeading";
import { fadeUp, staggerContainer } from "@nkps/shared/lib/animations";
import type { SectionCard } from "@nkps/shared/types";

interface FacilitiesPreviewProps {
  cards?: SectionCard[];
}

const iconMap: Record<string, React.ComponentType<{ className?: string }>> = {
  Monitor,
  FlaskConical,
  Laptop,
  BookOpen,
};

export function FacilitiesPreview({ cards }: FacilitiesPreviewProps = {}) {
  // Single source of truth: section_cards. Defaults are seeded as is_default
  // rows (migration 054).
  const preview = (cards ?? []).map((c) => ({
    id: c.id,
    title: c.title || "",
    description: c.description || "",
    icon: c.icon || "Monitor",
    image: c.image_url || "/images/news/n1.jpg",
  }));

  if (preview.length === 0) return null;

  return (
    <section className="section-padding overflow-hidden">
      <div className="page-container">
        <SectionHeading
          label="Our Campus"
          title="Explore Our Facilities"
          subtitle="State-of-the-art infrastructure for holistic development"
        />

        <motion.div
          variants={staggerContainer}
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: "-100px" }}
          className="grid grid-cols-2 lg:grid-cols-4 gap-4 md:gap-6 mt-12"
        >
          {preview.map((facility) => {
            const Icon = iconMap[facility.icon] || Monitor;
            return (
              <motion.div
                key={facility.id}
                variants={fadeUp}
              >
                <Link
                  href="/facilities"
                  aria-label={`Learn more about ${facility.title}`}
                  className="group relative block aspect-[3/4] rounded-3xl overflow-hidden shadow-lg shadow-black/10 hover:shadow-2xl hover:shadow-black/20 transition-shadow duration-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-500 focus-visible:ring-offset-2"
                >
                  {/* Background image */}
                  <Image
                    src={facility.image}
                    alt={`${facility.title} at NK Public School, Murlipura — Arya Nagar, Jaipur`}
                    fill
                    sizes="(min-width: 1024px) 25vw, 50vw"
                    className="object-cover transition-transform duration-[800ms] ease-out group-hover:scale-[1.12]"
                  />

                  {/* Gradient overlay — richer transition */}
                  <div className="absolute inset-0 bg-gradient-to-t from-navy-950/85 via-navy-950/20 to-transparent transition-all duration-700 group-hover:from-navy-950/95 group-hover:via-navy-950/40" />

                  {/* Icon badge — animated on hover */}
                  <div className="absolute top-3 right-3 sm:top-5 sm:right-5 w-9 h-9 sm:w-12 sm:h-12 rounded-full bg-white/10 backdrop-blur-md flex items-center justify-center border border-white/20 transition-all duration-500 group-hover:bg-gold-500/20 group-hover:border-gold-400/30 group-hover:scale-110">
                    <Icon className="w-4 h-4 sm:w-5 sm:h-5 text-white transition-colors duration-500 group-hover:text-gold-400" />
                  </div>

                  {/* Content at bottom */}
                  <div className="absolute bottom-0 left-0 right-0 p-4 sm:p-6 md:p-7">
                    <h3 className="font-heading text-base sm:text-lg md:text-xl font-bold text-white">
                      {facility.title}
                    </h3>
                    <p className="text-gray-300/90 text-sm mt-2 leading-relaxed line-clamp-2 opacity-0 translate-y-3 group-hover:opacity-100 group-hover:translate-y-0 transition-all duration-500 delay-100">
                      {facility.description}
                    </p>
                    {/* Gold accent line */}
                    <div className="w-0 h-0.5 bg-gold-400/60 rounded-full mt-3 group-hover:w-12 transition-all duration-500 delay-200" />
                  </div>
                </Link>
              </motion.div>
            );
          })}
        </motion.div>

        {/* View All link */}
        <div className="mt-8 text-center">
          <Link
            href="/facilities"
            className="group inline-flex items-center gap-2 text-navy-900 font-semibold hover:text-gold-600 transition-colors duration-300"
          >
            View All Facilities
            <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform duration-300" />
          </Link>
        </div>
      </div>
    </section>
  );
}
