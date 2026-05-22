"use client";

import { motion } from "framer-motion";
import { cn } from "@nkps/shared/lib/utils";

interface GlassCardProps {
  children: React.ReactNode;
  className?: string;
  hover?: boolean;
}

export function GlassCard({ children, className, hover }: GlassCardProps) {
  if (hover) {
    return (
      <motion.div
        className={cn("glass-card cursor-pointer", className)}
        whileHover={{ scale: 1.02 }}
        transition={{ type: "spring", stiffness: 300, damping: 20 }}
      >
        {children}
      </motion.div>
    );
  }

  return (
    <div className={cn("glass-card", className)}>
      {children}
    </div>
  );
}
