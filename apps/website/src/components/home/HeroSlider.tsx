"use client";

import { useState, useEffect, useCallback } from "react";
import { AnimatePresence, motion, useTransform } from "framer-motion";
import { ArrowRight, Users, CalendarDays, GraduationCap, Building2 } from "lucide-react";
import Link from "next/link";
import Image from "next/image";
import { cn } from "@nkps/shared/lib/utils";
import { useMouseMotion } from "@nkps/shared/hooks/useMousePosition";
import type { SectionCard } from "@nkps/shared/types";

const stats = [
  { number: "20,000+", label: "Students", icon: Users },
  { number: "40+", label: "Years", icon: CalendarDays },
  { number: "300+", label: "Faculty", icon: GraduationCap },
  { number: "6", label: "Institutes", icon: Building2 },
];

const INTERVAL = 7000;
const CHAR_DELAY = 28;

/* ─── FadeIn wrapper ─── */
function FadeIn({
  delay = 0,
  duration = 800,
  children,
  className,
}: {
  delay?: number;
  duration?: number;
  children: React.ReactNode;
  className?: string;
}) {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setVisible(true), delay);
    return () => clearTimeout(t);
  }, [delay]);

  return (
    <span
      className={cn("transition-opacity inline-block", className)}
      style={{
        opacity: visible ? 1 : 0,
        transitionDuration: `${duration}ms`,
      }}
    >
      {children}
    </span>
  );
}

/* ─── AnimatedHeading — character-by-character reveal ─── */
function AnimatedHeading({
  text,
  slideKey,
}: {
  text: string;
  slideKey: number;
}) {
  // Derive `animate` from whether the timeout for the current slideKey has
  // fired. Using a state value rather than calling setAnimate(false) in the
  // effect body avoids the synchronous-setState-in-effect warning.
  const [readyKey, setReadyKey] = useState<number | null>(null);
  const animate = readyKey === slideKey;

  useEffect(() => {
    const t = setTimeout(() => setReadyKey(slideKey), 150);
    return () => clearTimeout(t);
  }, [slideKey]);

  const lines = text.split("\n");

  return (
    <h1
      className="font-heading text-4xl md:text-5xl lg:text-6xl xl:text-7xl font-bold leading-[1.08] text-white"
      style={{ letterSpacing: "-0.03em" }}
    >
      {lines.map((line, lineIdx) => {
        const prevChars = lines
          .slice(0, lineIdx)
          .reduce((sum, l) => sum + l.length, 0);
        return (
          <span key={lineIdx} className="block">
            {line.split("").map((char, charIdx) => {
              const globalIdx = prevChars + charIdx;
              const isGoldLine = lineIdx === lines.length - 1;
              return (
                <span
                  key={`${slideKey}-${lineIdx}-${charIdx}`}
                  className={cn(
                    "inline-block transition-all",
                    isGoldLine ? "text-gold-400" : "text-white"
                  )}
                  style={{
                    opacity: animate ? 1 : 0,
                    transform: animate
                      ? "translateX(0)"
                      : "translateX(-18px)",
                    transitionDuration: "500ms",
                    transitionDelay: `${200 + globalIdx * CHAR_DELAY}ms`,
                    transitionTimingFunction: "cubic-bezier(0.25, 0.46, 0.45, 0.94)",
                  }}
                >
                  {char === " " ? "\u00A0" : char}
                </span>
              );
            })}
          </span>
        );
      })}
    </h1>
  );
}

/* ─── Main Hero Component ─── */
interface HeroSliderProps {
  cards?: SectionCard[];
}

export function HeroSlider({ cards }: HeroSliderProps = {}) {
  // Single source of truth: section_cards. Defaults are seeded as is_default
  // rows (migration 053). Title may contain a literal newline that the
  // animated heading splits on for the line break.
  const slides = (cards ?? []).map((c) => ({
    title: c.title || "",
    subtitle: c.subtitle || "",
    cta: c.cta_text || "Learn More",
    href: c.cta_link || "/",
    image: c.image_url || "/images/hero/campus-1.jpg",
    alt: c.title
      ? `${c.title.replace(/\n/g, " ")} — NK Public School Jaipur`
      : "NK Public School Jaipur campus",
  }));

  const [current, setCurrent] = useState(0);
  const [progress, setProgress] = useState(0);

  const goTo = useCallback((index: number) => {
    setCurrent(index);
    setProgress(0);
  }, []);

  /* ═══ PARALLAX ENGINE — 5 depth layers ═══ */
  const { x: mouseX, y: mouseY } = useMouseMotion(35, 16);

  // Layer 1: Background (far) — moves opposite, slow
  const bgX = useTransform(mouseX, (v) => v * -18);
  const bgY = useTransform(mouseY, (v) => v * -12);

  // Layer 2: Back orbs — slow drift
  const orbBackX = useTransform(mouseX, (v) => v * 20);
  const orbBackY = useTransform(mouseY, (v) => v * 15);

  // Layer 3: Mid orbs — moderate
  const orbMidX = useTransform(mouseX, (v) => v * -30);
  const orbMidY = useTransform(mouseY, (v) => v * -22);

  // Layer 4: Front accents — fast
  const orbFrontX = useTransform(mouseX, (v) => v * 40);
  const orbFrontY = useTransform(mouseY, (v) => v * 30);

  // Layer 5: Content — subtle
  const contentX = useTransform(mouseX, (v) => v * 4);
  const contentY = useTransform(mouseY, (v) => v * 3);

  /* Auto-advance */
  useEffect(() => {
    if (slides.length === 0) return;
    const start = performance.now();
    let raf: number;
    function tick(now: number) {
      const elapsed = now - start;
      const pct = Math.min(elapsed / INTERVAL, 1);
      setProgress(pct);
      if (pct < 1) {
        raf = requestAnimationFrame(tick);
      } else {
        setCurrent((prev) => (prev + 1) % slides.length);
        setProgress(0);
      }
    }
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [current, slides.length]);

  if (slides.length === 0) return null;

  // Cards can shrink (deactivated/deleted) between renders; clamp the index
  // so we never dereference past the end of the array.
  const safeCurrent = Math.min(current, slides.length - 1);
  const activeSlide = slides[safeCurrent];

  /* Animation delays */
  const titleCharCount = activeSlide.title.replace(/\n/g, "").length;
  const subtitleDelay = 200 + titleCharCount * CHAR_DELAY + 200;
  const ctaDelay = subtitleDelay + 400;
  const tagDelay = ctaDelay + 200;

  return (
    <section className="relative h-screen w-full overflow-hidden bg-navy-950">

      {/* ═══ LAYER 1: Background image — parallax tracked ═══ */}
      <AnimatePresence mode="wait">
        <motion.div
          key={safeCurrent}
          className="absolute -inset-5"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{
            opacity: { duration: 1.2, ease: "easeInOut" },
          }}
          style={{ x: bgX, y: bgY }}
        >
          <Image
            src={activeSlide.image}
            alt={activeSlide.alt}
            fill
            className="object-cover"
            priority={safeCurrent === 0}
            sizes="100vw"
          />
        </motion.div>
      </AnimatePresence>

      {/* ═══ LAYER 2: Rich translucent overlay ═══ */}
      <div className="absolute inset-0 bg-gradient-to-t from-navy-950/85 via-navy-950/45 to-navy-950/60" />
      <div className="absolute inset-0 bg-gradient-to-r from-navy-950/60 via-transparent to-navy-950/20" />
      {/* Subtle noise texture */}
      <div
        className="absolute inset-0 opacity-[0.03] mix-blend-overlay"
        style={{
          backgroundImage: "radial-gradient(circle, rgba(255,255,255,0.9) 1px, transparent 1px)",
          backgroundSize: "20px 20px",
        }}
      />

      {/* ═══ LAYER 3: Back parallax orbs (slow, large, diffuse) ═══ */}
      <motion.div
        className="absolute inset-0 pointer-events-none z-[2]"
        style={{ x: orbBackX, y: orbBackY }}
      >
        {/* Large gold ring — top right */}
        <motion.div
          className="absolute top-[8%] right-[12%] w-64 h-64 rounded-full border border-gold-400/15"
          animate={{ rotate: [0, 360] }}
          transition={{ duration: 50, repeat: Infinity, ease: "linear" }}
        />
        {/* Soft gold glow blob — center left */}
        <div className="absolute top-[30%] left-[5%] w-80 h-80 rounded-full bg-gold-500/[0.04] blur-3xl" />
        {/* Small white ring — bottom center */}
        <div className="absolute bottom-[20%] left-[45%] w-16 h-16 rounded-full border border-white/8" />
        {/* Tiny gold dot — top left */}
        <div className="absolute top-[18%] left-[25%] w-2 h-2 rounded-full bg-gold-400/40" />
      </motion.div>

      {/* ═══ LAYER 4: Mid parallax orbs (inverted, medium, sharper) ═══ */}
      <motion.div
        className="absolute inset-0 pointer-events-none z-[3]"
        style={{ x: orbMidX, y: orbMidY }}
      >
        {/* Medium rotating square — top center */}
        <motion.div
          className="absolute top-[15%] left-[50%] w-20 h-20 rounded-xl border border-gold-400/12 rotate-45"
          animate={{ rotate: [45, -45, 45] }}
          transition={{ duration: 14, repeat: Infinity, ease: "easeInOut" }}
        />
        {/* Gold circle — right middle */}
        <motion.div
          className="absolute top-[50%] right-[8%] w-28 h-28 rounded-full border border-white/10"
          animate={{ scale: [1, 1.08, 1] }}
          transition={{ duration: 6, repeat: Infinity, ease: "easeInOut" }}
        />
        {/* Tiny floating dot */}
        <motion.div
          className="absolute bottom-[35%] left-[18%] w-3 h-3 rounded-full bg-gold-400/30"
          animate={{ y: [0, -12, 0] }}
          transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
        />
        {/* Diffuse navy glow — bottom right */}
        <div className="absolute bottom-[10%] right-[15%] w-60 h-60 rounded-full bg-navy-600/10 blur-3xl" />
      </motion.div>

      {/* ═══ LAYER 5: Front parallax accents (fast, small, bright) ═══ */}
      <motion.div
        className="absolute inset-0 pointer-events-none z-[4]"
        style={{ x: orbFrontX, y: orbFrontY }}
      >
        {/* Small gold diamond — left */}
        <motion.div
          className="absolute top-[25%] left-[12%] w-6 h-6 rounded-sm border border-gold-400/25 rotate-45"
          animate={{ rotate: [45, 135, 45] }}
          transition={{ duration: 10, repeat: Infinity, ease: "easeInOut" }}
        />
        {/* Bright gold dot — right of center */}
        <motion.div
          className="absolute top-[40%] right-[30%] w-2.5 h-2.5 rounded-full bg-gold-400/50"
          animate={{ opacity: [0.5, 0.2, 0.5], scale: [1, 1.3, 1] }}
          transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }}
        />
        {/* Tiny white dot — bottom left */}
        <div className="absolute bottom-[28%] left-[35%] w-1.5 h-1.5 rounded-full bg-white/20" />
        {/* Gold dash accent — top right area */}
        <motion.div
          className="absolute top-[12%] right-[35%] w-8 h-px bg-gold-400/20"
          animate={{ scaleX: [1, 1.5, 1], opacity: [0.2, 0.4, 0.2] }}
          transition={{ duration: 5, repeat: Infinity, ease: "easeInOut" }}
        />
        {/* Small ring — bottom right */}
        <motion.div
          className="absolute bottom-[40%] right-[18%] w-10 h-10 rounded-full border border-gold-400/15"
          animate={{ y: [0, -8, 0] }}
          transition={{ duration: 5, repeat: Infinity, ease: "easeInOut", delay: 1 }}
        />
      </motion.div>

      {/* ═══ LAYER 6: Content — subtle parallax ═══ */}
      <motion.div
        className="relative z-10 flex h-full flex-col px-6 md:px-12 lg:px-16"
        style={{ x: contentX, y: contentY }}
      >
        <div className="flex-1" />

        <div className="pb-40 md:pb-36 lg:pb-28">
          <div className="lg:grid lg:grid-cols-2 lg:items-end lg:gap-12">
            {/* Left — Main content */}
            <div>
              <AnimatedHeading
                text={activeSlide.title}
                slideKey={safeCurrent}
              />

              <FadeIn
                key={`sub-${safeCurrent}`}
                delay={subtitleDelay}
                duration={800}
                className="block"
              >
                <p className="mt-5 text-base md:text-lg text-gray-300/90 max-w-xl leading-relaxed">
                  {activeSlide.subtitle}
                </p>
              </FadeIn>

              <FadeIn
                key={`cta-${safeCurrent}`}
                delay={ctaDelay}
                duration={800}
                className="block"
              >
                <div className="mt-7 flex flex-wrap items-center gap-4">
                  <Link
                    href={activeSlide.href}
                    className="group liquid-glass border border-white/20 text-white px-8 py-3.5 rounded-xl font-medium transition-all duration-300 hover:bg-white hover:text-navy-900 inline-flex items-center gap-2.5 hover:shadow-lg hover:shadow-white/10"
                  >
                    {activeSlide.cta}
                    <ArrowRight className="w-4 h-4 transition-transform duration-300 group-hover:translate-x-1" />
                  </Link>
                  <Link
                    href="/contact"
                    className="text-sm text-gray-400 hover:text-white transition-colors duration-300 font-medium px-2"
                  >
                    Contact Us &rarr;
                  </Link>
                </div>
              </FadeIn>
            </div>

            {/* Right — Tag card */}
            <div className="hidden lg:flex items-end justify-end mt-8 lg:mt-0">
              <FadeIn
                key={`tag-${safeCurrent}`}
                delay={tagDelay}
                duration={800}
              >
                <div className="liquid-glass border border-white/15 px-6 py-3.5 rounded-xl gold-glow-sm">
                  <p className="text-lg md:text-xl lg:text-2xl font-light text-white/90 tracking-tight">
                    CBSE Affiliated&ensp;&middot;&ensp;Est. 1985&ensp;&middot;&ensp;6 Campuses
                  </p>
                </div>
              </FadeIn>
            </div>
          </div>
        </div>
      </motion.div>

      {/* ═══ Stats bar ═══ */}
      <div className="absolute bottom-6 left-0 right-0 z-20 px-4 md:px-12 lg:px-16">
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 1.5 }}
          className="mx-auto max-w-5xl liquid-glass border border-white/12 rounded-2xl px-4 py-4 md:px-6 md:py-5"
        >
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4 md:gap-0 md:divide-x md:divide-white/12">
            {stats.map((stat, i) => {
              const Icon = stat.icon;
              return (
                <div
                  key={i}
                  className="flex items-center justify-center gap-3 md:px-4"
                >
                  <div className="hidden md:flex w-9 h-9 rounded-lg bg-white/8 items-center justify-center shrink-0">
                    <Icon className="h-4 w-4 text-gold-400" />
                  </div>
                  <div className="text-center md:text-left">
                    <span className="block text-lg md:text-2xl font-semibold text-white leading-tight">
                      {stat.number}
                    </span>
                    <span className="block text-[10px] md:text-xs uppercase tracking-wider text-gray-400/80">
                      {stat.label}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </motion.div>
      </div>

      {/* ═══ Slide indicators ═══ */}
      <div className="absolute right-2 sm:right-4 md:right-8 top-1/2 -translate-y-1/2 z-20 flex flex-col items-center gap-2.5">
        {slides.map((_, index) => (
          <button
            key={index}
            onClick={() => goTo(index)}
            className="group relative flex items-center justify-center cursor-pointer p-2"
            aria-label={`Go to slide ${index + 1}`}
          >
            <span
              className={cn(
                "block w-1 rounded-full transition-all duration-500",
                index === safeCurrent
                  ? "h-8 bg-gold-400 gold-glow-sm"
                  : "h-3 bg-white/25 group-hover:bg-white/50"
              )}
            />
          </button>
        ))}
      </div>

      {/* ═══ Progress bar ═══ */}
      <div className="absolute bottom-0 left-0 right-0 z-30 h-[2px] bg-white/8">
        <motion.div
          className="h-full bg-gradient-to-r from-gold-500 to-gold-400"
          style={{ width: `${progress * 100}%` }}
        />
      </div>
    </section>
  );
}
