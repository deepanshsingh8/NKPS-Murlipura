"use client";

import { motion } from "framer-motion";
import { cn } from "@nkps/shared/lib/utils";

interface SectionHeadingProps {
  title: string;
  subtitle?: string;
  label?: string;
  light?: boolean;
  className?: string;
}

export function SectionHeading({ title, subtitle, label, light, className }: SectionHeadingProps) {
  return (
    <div className={cn("text-center", className)}>
      {label && (
        <span
          className={cn(
            "inline-block text-xs font-semibold uppercase tracking-[0.2em] mb-3",
            light ? "text-gold-400" : "text-gold-600"
          )}
        >
          {label}
        </span>
      )}
      <h2
        className={cn(
          "font-heading text-2xl sm:text-3xl md:text-4xl font-bold",
          light ? "text-white" : "text-navy-900"
        )}
      >
        {title}
      </h2>
      <motion.div
        initial={{ width: 0 }}
        whileInView={{ width: 64 }}
        viewport={{ once: true }}
        transition={{ duration: 0.6, ease: "easeOut", delay: 0.2 }}
        className="h-1 bg-gold-500 mx-auto mt-4 rounded-full"
      />
      {subtitle && (
        <p
          className={cn(
            "mt-4 max-w-2xl mx-auto text-base sm:text-lg",
            light ? "text-gray-300" : "text-gray-500"
          )}
        >
          {subtitle}
        </p>
      )}
    </div>
  );
}
