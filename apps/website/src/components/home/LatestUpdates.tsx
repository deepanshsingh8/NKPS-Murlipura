"use client";

import Image from "next/image";
import Link from "next/link";
import { motion } from "framer-motion";
import { ArrowRight } from "lucide-react";
import { staggerContainer, fadeUp } from "@nkps/shared/lib/animations";
import { SectionHeading } from "@nkps/shared/components/SectionHeading";
import type { SectionCard, Article } from "@nkps/shared/types";

interface LatestUpdatesProps {
  cards?: SectionCard[];
  articles?: Article[];
}

function formatMonthYear(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString("en-IN", {
    month: "long",
    year: "numeric",
  });
}

// section_cards.link is admin-editable and may contain placeholder text like
// "latest update 4" left over from seed data. Anything that isn't an absolute
// path or external URL would resolve as a relative path and 404.
function safeLink(raw: string | null | undefined): string {
  if (!raw || typeof raw !== "string") return "/articles";
  const trimmed = raw.trim();
  if (!trimmed) return "/articles";
  if (trimmed.startsWith("/")) return trimmed;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return "/articles";
}

export function LatestUpdates({ cards, articles }: LatestUpdatesProps = {}) {
  const hasArticles = (articles?.length ?? 0) > 0;

  // Cards always come from section_cards. When published articles exist they
  // take precedence over the section_cards (live news beats evergreen
  // defaults); otherwise the cards render directly.
  const dbUpdates = (cards ?? []).map((c, i) => ({
    key: c.id ?? `card-${i}`,
    date: c.date || "",
    title: c.title || "",
    description: c.description || "",
    image: c.image_url || "/images/news/n2.jpg",
    link: safeLink(c.link),
  }));

  const articleUpdates = (articles ?? []).map((a, i) => ({
    key: a.id,
    date: formatMonthYear(a.published_at),
    title: a.title,
    description: a.excerpt || "",
    image: a.cover_image_url || dbUpdates[i % Math.max(dbUpdates.length, 1)]?.image || "/images/news/n2.jpg",
    link: `/articles/${a.slug}` as string,
  }));

  const updates = hasArticles ? articleUpdates : dbUpdates;
  if (updates.length === 0) return null;

  return (
    <section className="section-padding relative overflow-hidden">
      <div className="page-container relative z-10">
        <SectionHeading
          label="News & Announcements"
          title="Latest Updates"
          subtitle="Stay informed with school news and announcements"
        />

        <motion.div
          variants={staggerContainer}
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: "-100px" }}
          className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-7 mt-12"
        >
          {updates.map((item) => (
            <motion.div key={item.key} variants={fadeUp} whileHover={{ y: -6 }} transition={{ type: "spring", stiffness: 300, damping: 25 }}>
              <Link
                href={item.link}
                className="group block rounded-3xl overflow-hidden bg-white border border-gray-100/80 shadow-sm hover:shadow-xl hover:shadow-gold-500/8 hover:border-gold-500/20 transition-all duration-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-500 focus-visible:ring-offset-2"
              >
                {/* Image */}
                <div className="relative h-52 w-full overflow-hidden">
                  <Image
                    src={item.image}
                    alt={item.title}
                    fill
                    sizes="(min-width: 1024px) 33vw, (min-width: 768px) 50vw, 100vw"
                    className="object-cover transition-transform duration-[800ms] ease-out group-hover:scale-[1.08]"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-navy-950/20 to-transparent group-hover:from-navy-950/30 transition-all duration-500" />
                </div>

                {/* Content */}
                <div className="p-6">
                  {/* Date badge — animated border */}
                  <span className="inline-block bg-gold-500/8 text-gold-600 text-xs font-semibold px-3.5 py-1.5 rounded-full border border-gold-500/15 group-hover:bg-gold-500/15 group-hover:border-gold-500/25 transition-all duration-300">
                    {item.date}
                  </span>

                  <h3 className="font-heading text-lg font-semibold text-navy-900 mt-3 line-clamp-2 leading-snug">
                    {item.title}
                  </h3>

                  <p className="text-gray-500 text-sm mt-2 leading-relaxed line-clamp-2">
                    {item.description}
                  </p>

                  <div className="mt-4 flex items-center gap-1.5 text-navy-900 text-sm font-medium group-hover:text-gold-600 transition-colors duration-300">
                    Read more
                    <ArrowRight className="w-3.5 h-3.5 group-hover:translate-x-1.5 transition-transform duration-300" />
                  </div>
                </div>
              </Link>
            </motion.div>
          ))}
        </motion.div>

        {hasArticles && (
          <div className="mt-10 text-center">
            <Link
              href="/articles"
              className="group inline-flex items-center gap-2 text-navy-900 font-semibold hover:text-gold-600 transition-colors duration-300"
            >
              View All Articles
              <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform duration-300" />
            </Link>
          </div>
        )}
      </div>
    </section>
  );
}
