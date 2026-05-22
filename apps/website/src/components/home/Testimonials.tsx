"use client";

import { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Quote, Star } from "lucide-react";
import { cn } from "@nkps/shared/lib/utils";
import { SectionHeading } from "@nkps/shared/components/SectionHeading";
import Image from "next/image";
import type { SectionCard } from "@nkps/shared/types";

interface TestimonialsProps {
  cards?: SectionCard[];
}

export function Testimonials({ cards }: TestimonialsProps = {}) {
  // Single source of truth: section_cards. Default testimonials are seeded
  // there as is_default rows (migration 051) and arrive in this prop alongside
  // any user-added ones. getSectionCards already filters is_active=true.
  const activeTestimonials = (cards ?? []).map((c) => ({
    id: c.id,
    quote: c.quote || "",
    name: c.name || "",
    role: c.role || "",
    initials: c.initials || (c.name?.[0] ?? ""),
    image: c.image_url || null,
  }));

  const [active, setActive] = useState(0);

  const next = useCallback(() => {
    setActive((prev) =>
      activeTestimonials.length === 0 ? 0 : (prev + 1) % activeTestimonials.length
    );
  }, [activeTestimonials.length]);

  useEffect(() => {
    if (activeTestimonials.length === 0) return;
    const timer = setInterval(next, 5000);
    return () => clearInterval(timer);
  }, [next, activeTestimonials.length]);

  if (activeTestimonials.length === 0) return null;

  return (
    <section className="bg-white section-padding relative overflow-hidden">
      <div className="page-container relative z-10">
        <SectionHeading
          label="Testimonials"
          title="What Parents Say"
          subtitle="Hear from our school community"
        />

        <div className="mt-12 md:mt-16 max-w-3xl mx-auto">
          {/* Quote card — premium with glow border */}
          <div className="relative bg-cream-50 rounded-3xl p-8 md:p-12 border border-gold-500/10 shadow-lg shadow-gold-500/[0.04] hover:shadow-xl hover:shadow-gold-500/[0.08] transition-shadow duration-700">
            {/* Quote icon — with pulse glow */}
            <div className="absolute -top-5 left-8 md:left-12 w-10 h-10 rounded-full bg-gradient-to-br from-gold-500 to-gold-400 flex items-center justify-center shadow-lg shadow-gold-500/30" style={{ animation: "pulse-gold 3s ease-in-out infinite" }}>
              <Quote className="w-5 h-5 text-navy-900" />
            </div>

            <AnimatePresence mode="wait">
              <motion.div
                key={active}
                initial={{ opacity: 0, y: 15 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -15 }}
                transition={{ duration: 0.4, ease: "easeInOut" }}
              >
                {/* Stars */}
                <div className="flex items-center gap-1 mb-5">
                  {[...Array(5)].map((_, i) => (
                    <Star key={i} className="w-4 h-4 fill-gold-500 text-gold-500" />
                  ))}
                </div>

                <p className="text-lg md:text-xl text-navy-800 leading-relaxed">
                  &ldquo;{activeTestimonials[active].quote}&rdquo;
                </p>

                <div className="mt-6 flex items-center gap-4">
                  <div className="w-11 h-11 rounded-full bg-gradient-to-br from-navy-900 to-navy-700 flex items-center justify-center text-white font-semibold ring-2 ring-gold-500/20 ring-offset-2 ring-offset-cream-50 overflow-hidden relative">
                    {activeTestimonials[active].image ? (
                      <Image
                        src={activeTestimonials[active].image!}
                        alt={activeTestimonials[active].name}
                        fill
                        className="object-cover"
                        sizes="44px"
                      />
                    ) : (
                      activeTestimonials[active].initials
                    )}
                  </div>
                  <div>
                    <p className="font-semibold text-navy-900">
                      {activeTestimonials[active].name}
                    </p>
                    <p className="text-gray-500 text-sm">
                      {activeTestimonials[active].role}
                    </p>
                  </div>
                </div>
              </motion.div>
            </AnimatePresence>
          </div>

          {/* Indicators */}
          <div className="flex items-center justify-center gap-3 mt-8">
            {activeTestimonials.map((t, i) => (
              <button
                key={t.id}
                onClick={() => setActive(i)}
                className="relative focus:outline-none cursor-pointer"
                aria-label={`View testimonial from ${t.name}`}
              >
                <div
                  className={cn(
                    "w-2.5 h-2.5 rounded-full transition-all duration-300",
                    i === active
                      ? "bg-gold-500 scale-125"
                      : "bg-gray-300 hover:bg-gray-400"
                  )}
                />
              </button>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
