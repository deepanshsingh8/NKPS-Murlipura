"use client";

import { motion, useTransform } from "framer-motion";
import { useMouseMotion } from "@nkps/shared/hooks/useMousePosition";
import { cn } from "@nkps/shared/lib/utils";

interface MouseParallaxProps {
  children: React.ReactNode;
  /** How much the element moves (px). Default 20. */
  strength?: number;
  /** Invert direction. */
  invert?: boolean;
  className?: string;
}

/**
 * Wraps children in a layer that shifts based on mouse position.
 * Zero re-renders — uses motion values and transforms.
 */
export function MouseParallax({
  children,
  strength = 20,
  invert = false,
  className,
}: MouseParallaxProps) {
  const { x: mouseX, y: mouseY } = useMouseMotion();
  const factor = invert ? -strength : strength;

  const x = useTransform(mouseX, (v) => v * factor);
  const y = useTransform(mouseY, (v) => v * factor);

  return (
    <motion.div className={cn(className)} style={{ x, y }}>
      {children}
    </motion.div>
  );
}
