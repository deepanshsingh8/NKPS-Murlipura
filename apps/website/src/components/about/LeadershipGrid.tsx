"use client";

import Image from "next/image";
import { motion } from "framer-motion";
import { SectionHeading } from "@nkps/shared/components/SectionHeading";
import { GlassCard } from "@nkps/shared/components/GlassCard";
import { staggerContainer, fadeUp } from "@nkps/shared/lib/animations";
import type { SectionCard } from "@nkps/shared/types";

interface LeadershipGridProps {
  cards?: SectionCard[];
}

function getInitials(name: string): string {
  return name
    .replace(/^(Dr\.|Mr\.|Mrs\.|Ms\.)\s*/i, "")
    .split(" ")
    .filter(Boolean)
    .map((w) => w[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

export function LeadershipGrid({ cards }: LeadershipGridProps = {}) {
  // Single source of truth: section_cards. Default leaders are seeded as
  // is_default rows (migration 051) with their photos in image_url.
  const allLeaders = (cards ?? []).map((c) => ({
    id: c.id,
    name: c.name || "",
    designation: c.designation || "",
    message: c.message || "",
    photo: c.image_url || null,
  }));

  if (allLeaders.length === 0) return null;

  return (
    <section className="section-padding">
      <div className="page-container">
        <SectionHeading title="Our Leadership" />

        <motion.div
          variants={staggerContainer}
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true }}
          className="grid grid-cols-1 md:grid-cols-3 gap-8 mt-12"
        >
          {allLeaders.map((leader) => {
            const photo = leader.photo;
            return (
              <motion.div key={leader.id} variants={fadeUp}>
                <GlassCard className="p-8 text-center" hover>
                  {/* Avatar */}
                  <div className="w-28 h-28 rounded-full mx-auto mb-4 overflow-hidden border-3 border-gold-500/20">
                    {photo ? (
                      <Image
                        src={photo}
                        alt={leader.name}
                        width={112}
                        height={112}
                        className="object-cover w-full h-full"
                      />
                    ) : (
                      <div className="w-full h-full bg-gradient-to-br from-navy-800 to-navy-900 flex items-center justify-center">
                        <span className="font-heading text-2xl font-bold text-white">
                          {getInitials(leader.name)}
                        </span>
                      </div>
                    )}
                  </div>

                  <h3 className="font-heading text-xl font-semibold text-navy-900">
                    {leader.name}
                  </h3>
                  <p className="text-gold-600 text-sm uppercase tracking-wider mt-1">
                    {leader.designation}
                  </p>
                  {leader.message && (
                    <p className="text-gray-600 italic mt-4 text-sm">
                      &ldquo;{leader.message}&rdquo;
                    </p>
                  )}
                </GlassCard>
              </motion.div>
            );
          })}
        </motion.div>
      </div>
    </section>
  );
}
