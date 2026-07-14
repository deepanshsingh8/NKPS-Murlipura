"use client";

import Image from "next/image";
import Link from "next/link";
import { motion } from "framer-motion";
import { GraduationCap, Award, ArrowRight, Quote } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { AnimatedSection } from "@nkps/shared/components/AnimatedSection";
import { SectionHeading } from "@nkps/shared/components/SectionHeading";
import { PageTransition } from "@nkps/shared/components/PageTransition";
import { SectionDivider } from "@nkps/shared/components/SectionDivider";
import { staggerContainer, fadeUp } from "@nkps/shared/lib/animations";
import type { SectionCard } from "@nkps/shared/types";

interface AlumniPageClientProps {
  cards?: SectionCard[];
}

function initialsFor(card: SectionCard): string {
  if (card.initials) return card.initials;
  const name = card.name?.trim();
  if (!name) return "★";
  const parts = name.split(/\s+/);
  return (parts[0]?.[0] ?? "") + (parts.length > 1 ? parts[parts.length - 1][0] : "");
}

export function AlumniPageClient({ cards }: AlumniPageClientProps) {
  const alumni = cards ?? [];

  return (
    <PageTransition>
      <PageHeader
        title="Our Alumni"
        subtitle="Celebrating the achievements of those who walked these halls before"
      />

      {/* Intro */}
      <section className="py-20 px-6">
        <div className="mx-auto max-w-3xl text-center">
          <AnimatedSection>
            <div className="mx-auto mb-6 flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-gold-500 to-gold-400 shadow-lg shadow-gold-500/25">
              <GraduationCap className="h-7 w-7 text-white" />
            </div>
            <h2 className="font-heading text-3xl md:text-4xl font-bold text-chalk">
              A Network That Lasts a Lifetime
            </h2>
            <div className="mx-auto mt-4 h-1 w-16 rounded-full bg-gold-500" />
            <p className="mt-6 text-base md:text-lg leading-relaxed text-chalk-dim">
              For over four decades, NK Public School, Murlipura has nurtured
              students who have gone on to make their mark across the world — in
              medicine, engineering, civil services, business, sports and the
              arts. Our alumni are our proudest achievement, and their stories
              continue to inspire the students of today. We&apos;re building a
              vibrant alumni network to stay connected, give back, and celebrate
              every milestone together.
            </p>
          </AnimatedSection>
        </div>
      </section>

      <SectionDivider color="fill-board" />

      {/* Achievements grid */}
      <section className="py-20 px-6">
        <div className="mx-auto max-w-6xl">
          <AnimatedSection>
            <SectionHeading
              label="Special Achievements"
              title="Alumni in the Spotlight"
              subtitle="Notable accomplishments of our alumni after passing out of NKPS"
              light
            />
          </AnimatedSection>

          {alumni.length === 0 ? (
            <p className="mt-12 text-center text-chalk-faint">
              Alumni achievements will be featured here soon.
            </p>
          ) : (
            <motion.div
              variants={staggerContainer}
              initial="hidden"
              whileInView="visible"
              viewport={{ once: true, margin: "-100px" }}
              className="mt-12 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5 md:gap-6"
            >
              {alumni.map((person) => (
                <motion.div
                  key={person.id}
                  variants={fadeUp}
                  className="group flex flex-col overflow-hidden rounded-3xl bg-white border border-gray-100 shadow-[0_14px_28px_-14px_rgba(0,0,0,0.55)] transition-shadow duration-500 hover:shadow-[0_20px_40px_-16px_rgba(0,0,0,0.7)]"
                >
                  {/* Photo / initials */}
                  <div className="relative aspect-[4/3] overflow-hidden bg-navy-900">
                    {person.image_url ? (
                      <Image
                        src={person.image_url}
                        alt={`${person.name ?? "Alumnus"} — NK Public School alumnus`}
                        fill
                        sizes="(min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw"
                        className="object-cover transition-transform duration-[800ms] ease-out group-hover:scale-105"
                      />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-navy-900 to-navy-700">
                        <span className="font-heading text-4xl font-bold text-gold-400">
                          {initialsFor(person)}
                        </span>
                      </div>
                    )}
                    {person.year && (
                      <span className="absolute top-4 left-4 inline-flex items-center gap-1.5 rounded-full bg-white/90 px-3 py-1 text-xs font-semibold text-navy-900 shadow-md backdrop-blur-sm">
                        <Award className="h-3.5 w-3.5 text-gold-500" />
                        {person.year}
                      </span>
                    )}
                  </div>

                  {/* Body */}
                  <div className="flex flex-1 flex-col p-6">
                    <h3 className="font-heading text-lg font-bold text-navy-900">
                      {person.name}
                    </h3>
                    {person.designation && (
                      <p className="mt-0.5 text-sm font-medium text-gold-700">
                        {person.designation}
                      </p>
                    )}
                    {person.description && (
                      <p className="mt-3 flex gap-2 text-sm leading-relaxed text-gray-600">
                        <Quote className="mt-0.5 h-4 w-4 shrink-0 text-gold-400/70" />
                        <span>{person.description}</span>
                      </p>
                    )}
                  </div>
                </motion.div>
              ))}
            </motion.div>
          )}
        </div>
      </section>

      <SectionDivider flip color="fill-board" />

      {/* Connect CTA */}
      <section className="py-20 px-6">
        <div className="mx-auto max-w-4xl">
          <AnimatedSection>
            <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-navy-900 to-navy-800 p-10 text-center md:p-14">
              <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-gold-500 to-gold-400" />
              <h3 className="font-heading text-2xl md:text-3xl font-bold text-white">
                Are You an NKPS Alumnus?
              </h3>
              <p className="mx-auto mt-4 max-w-xl text-sm md:text-base leading-relaxed text-gray-300">
                We&apos;d love to hear where life has taken you. Reconnect with
                your school, share your story, and become part of our growing
                alumni network.
              </p>
              <Link
                href="/contact"
                className="mt-8 inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-gold-500 to-gold-400 px-8 py-3.5 font-semibold text-navy-900 shadow-lg shadow-gold-500/25 transition-all duration-300 hover:shadow-xl hover:shadow-gold-500/30 hover:brightness-110"
              >
                Connect With Us
                <ArrowRight className="h-4 w-4" />
              </Link>
            </div>
          </AnimatedSection>
        </div>
      </section>
    </PageTransition>
  );
}
