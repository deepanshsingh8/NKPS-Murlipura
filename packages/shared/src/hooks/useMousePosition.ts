"use client";

import { useMotionValue, useSpring, type MotionValue } from "framer-motion";
import { useEffect } from "react";

interface MouseMotion {
  x: MotionValue<number>;
  y: MotionValue<number>;
}

/**
 * Tracks mouse position as spring-animated motion values (-1 to 1).
 * Uses motion values (no re-renders) for buttery-smooth parallax.
 */
export function useMouseMotion(
  stiffness = 50,
  damping = 20
): MouseMotion {
  const rawX = useMotionValue(0);
  const rawY = useMotionValue(0);

  const x = useSpring(rawX, { stiffness, damping });
  const y = useSpring(rawY, { stiffness, damping });

  useEffect(() => {
    function handleMouseMove(e: MouseEvent) {
      rawX.set((e.clientX / window.innerWidth - 0.5) * 2);
      rawY.set((e.clientY / window.innerHeight - 0.5) * 2);
    }

    window.addEventListener("mousemove", handleMouseMove, { passive: true });
    return () => window.removeEventListener("mousemove", handleMouseMove);
  }, [rawX, rawY]);

  return { x, y };
}
