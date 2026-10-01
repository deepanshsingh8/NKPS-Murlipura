"use client";

import { motion } from "framer-motion";
import { fadeUp } from "@nkps/shared/lib/animations";
import { cn } from "@nkps/shared/lib/utils";

interface AnimatedSectionProps {
  children: React.ReactNode;
  className?: string;
  delay?: number;
  /**
   * Content visible on load (e.g. the first section under a page header).
   * Skips the opacity:0 start so it paints from the server HTML rather than
   * after hydration — otherwise it delays Largest Contentful Paint.
   */
  aboveFold?: boolean;
}

export function AnimatedSection({ children, className, delay, aboveFold }: AnimatedSectionProps) {
  return (
    <motion.div
      variants={fadeUp}
      initial={aboveFold ? false : "hidden"}
      whileInView="visible"
      viewport={{ once: true, margin: "-100px" }}
      transition={delay ? { delay } : undefined}
      className={cn(className)}
    >
      {children}
    </motion.div>
  );
}
