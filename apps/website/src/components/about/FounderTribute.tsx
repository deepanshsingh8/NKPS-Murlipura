"use client";

import Image from "next/image";
import { AnimatedSection } from "@nkps/shared/components/AnimatedSection";
import { SCHOOL } from "@nkps/shared/lib/constants";

interface FounderTributeProps {
  photoUrl?: string;
}

export function FounderTribute({ photoUrl }: FounderTributeProps = {}) {
  return (
    <section className="section-padding bg-navy-900 text-white">
      <div className="page-container">
        <AnimatedSection>
          <div className="text-center max-w-3xl mx-auto">
            {/* Decorative gold line */}
            <div className="w-20 h-0.5 bg-gold-500 mx-auto mb-10" />

            {/* Avatar */}
            <div className="w-40 h-40 rounded-full mx-auto mb-6 overflow-hidden border-4 border-gold-500/30">
              <Image
                src={photoUrl || "/images/about/rk-choudhary.png"}
                alt={SCHOOL.founder.name}
                width={160}
                height={160}
                className="object-cover w-full h-full"
              />
            </div>

            {/* Name */}
            <h2 className="font-heading text-2xl font-bold">
              {SCHOOL.founder.name}
            </h2>

            {/* Years */}
            <p className="text-gold-400 mt-1">{SCHOOL.founder.years}</p>

            {/* Subtitle */}
            <p className="text-gray-400 text-sm uppercase tracking-wider mt-2">
              Founder of NK Public School
            </p>

            {/* Bio */}
            <p className="text-gray-300 mt-6 leading-relaxed">
              {SCHOOL.founder.bio}
            </p>

            {/* Decorative gold line */}
            <div className="w-20 h-0.5 bg-gold-500 mx-auto mt-10" />
          </div>
        </AnimatedSection>
      </div>
    </section>
  );
}
