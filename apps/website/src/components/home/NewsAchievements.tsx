"use client";

import Image from "next/image";
import Link from "next/link";
import { Award, Newspaper, Trophy, type LucideIcon } from "lucide-react";
import { SectionHeading } from "@nkps/shared/components/SectionHeading";
import { cn } from "@nkps/shared/lib/utils";
import type { Article, SectionCard } from "@nkps/shared/types";

interface NewsAchievementsProps {
  articles?: Article[];
  studentAchievements?: SectionCard[];
  accolades?: SectionCard[];
}

// Normalised card shape shared by all three columns.
interface ColumnCard {
  key: string;
  image: string | null;
  title: string;
  meta?: string;
  text?: string;
  href?: string;
}

interface Column {
  key: string;
  label: string;
  icon: LucideIcon;
  cards: ColumnCard[];
}

// Below this count a column has too few cards to loop convincingly, so it
// renders as a static stack instead of an auto-scrolling marquee (mirrors the
// `isCarousel` guard in LatestUpdates).
const MIN_CARDS_TO_SCROLL = 3;

function formatMonthYear(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString("en-IN", {
    month: "long",
    year: "numeric",
  });
}

export function NewsAchievements({
  articles,
  studentAchievements,
  accolades,
}: NewsAchievementsProps = {}) {
  const columns: Column[] = [
    {
      key: "updates",
      label: "Latest Updates",
      icon: Newspaper,
      cards: (articles ?? []).map((a) => ({
        key: a.id,
        image: a.cover_image_url || "/images/news/n2.jpg",
        title: a.title,
        meta: formatMonthYear(a.published_at),
        text: a.excerpt || "",
        href: `/articles/${a.slug}`,
      })),
    },
    {
      key: "students",
      label: "Student Achievements",
      icon: Trophy,
      cards: (studentAchievements ?? []).map((c) => ({
        key: c.id,
        image: c.image_url,
        title: c.title || c.name || "",
        meta: [c.name, c.year].filter(Boolean).join(" · "),
        text: c.description || "",
      })),
    },
    {
      key: "school",
      label: "School Accolades",
      icon: Award,
      cards: (accolades ?? []).map((c) => ({
        key: c.id,
        image: c.image_url,
        title: c.title || "",
        text: c.description || "",
      })),
    },
  ].filter((col) => col.cards.length > 0);

  if (columns.length === 0) return null;

  return (
    <section className="section-padding overflow-hidden">
      <div className="page-container">
        <SectionHeading
          label="Recognition"
          title="News & Achievements"
          subtitle="School news, student honours and the recognition that drives us forward"
          light
        />

        <div className="mt-12 chalk-frame">
          <div className="chalk-inboard px-5 py-8 md:px-8">
            <div className="grid grid-cols-1 gap-10 md:grid-cols-3 md:gap-8 lg:gap-14">
              {columns.map((col) => (
                <ScrollColumn key={col.key} column={col} />
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function ScrollColumn({ column }: { column: Column }) {
  const { label, icon: Icon, cards } = column;
  const animate = cards.length >= MIN_CARDS_TO_SCROLL;
  // Duplicate the list for a seamless -50% translate loop. Each card carries its
  // own bottom spacing (pb-5) so the seam between the two copies matches the
  // internal gaps exactly.
  const loop = animate ? [...cards, ...cards] : cards;

  return (
    <div className="group/col flex flex-col">
      {/* Column header */}
      <div className="mb-4 flex items-center gap-2.5">
        <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-gold-500/15 text-chalk-gold">
          <Icon className="h-5 w-5" />
        </span>
        <h3 className="text-xl text-chalk">
          {label}
        </h3>
      </div>

      {/* Scroll viewport */}
      <div className="relative h-[24rem] overflow-hidden md:h-[30rem]">
        {/* Top / bottom fade masks — blend into the chalkboard surface */}
        <div className="pointer-events-none absolute inset-x-0 top-0 z-10 h-12 bg-gradient-to-b from-board-2 to-transparent" />
        <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 h-12 bg-gradient-to-t from-board-2 to-transparent" />

        <div
          className={cn(
            "flex flex-col",
            animate &&
              "animate-marquee-vertical group-hover/col:[animation-play-state:paused]"
          )}
        >
          {loop.map((card, i) => (
            <NewsCard key={`${card.key}-${i}`} card={card} />
          ))}
        </div>
      </div>
    </div>
  );
}

function NewsCard({ card }: { card: ColumnCard }) {
  const inner = (
    <div className="group/card overflow-hidden rounded-2xl border border-black/5 bg-white shadow-[0_14px_28px_-14px_rgba(0,0,0,0.55)] transition-shadow duration-500 hover:shadow-[0_20px_40px_-16px_rgba(0,0,0,0.7)]">
      {/* Thumbnail */}
      <div className="relative aspect-[16/9] w-full overflow-hidden bg-gray-100">
        {card.image ? (
          <Image
            src={card.image}
            alt={card.title}
            fill
            sizes="(min-width: 768px) 30vw, 100vw"
            className="object-cover transition-transform duration-[800ms] ease-out group-hover/card:scale-105"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-navy-800 to-navy-900">
            <Award className="h-8 w-8 text-gold-500/70" />
          </div>
        )}
      </div>

      {/* Body */}
      <div className="p-4">
        {card.meta && (
          <span className="inline-block rounded-full border border-gold-500/15 bg-gold-500/8 px-2.5 py-0.5 text-[11px] font-semibold text-gold-700">
            {card.meta}
          </span>
        )}
        <h4 className="mt-2 line-clamp-2 font-heading text-sm font-semibold leading-snug text-navy-900">
          {card.title}
        </h4>
        {card.text && (
          <p className="mt-1.5 line-clamp-2 text-xs leading-relaxed text-gray-500">
            {card.text}
          </p>
        )}
      </div>
    </div>
  );

  return (
    <div className="pb-5">
      {card.href ? (
        <Link
          href={card.href}
          className="block rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-500 focus-visible:ring-offset-2"
        >
          {inner}
        </Link>
      ) : (
        inner
      )}
    </div>
  );
}
