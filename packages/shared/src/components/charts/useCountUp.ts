"use client";

import { useEffect, useRef, useState } from "react";
import { usePrefersReducedMotion } from "@nkps/shared/hooks/useMediaQuery";

// Counts a stat-tile value up from zero on mount.
//
// Kept because it is what this dashboard has always done and it reads as the
// page coming alive rather than as decoration — but it is strictly cosmetic, so
// it is skipped entirely under prefers-reduced-motion and the final value is
// rendered immediately in that case.
export function useCountUp(target: number, durationMs = 900): number {
  const reduceMotion = usePrefersReducedMotion();
  const safeTarget = Number.isFinite(target) ? target : 0;
  const [display, setDisplay] = useState(safeTarget);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    if (reduceMotion || safeTarget === 0) {
      setDisplay(safeTarget);
      return;
    }

    const start = performance.now();
    const tick = (t: number) => {
      const progress = Math.min((t - start) / durationMs, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      setDisplay(Math.round(eased * safeTarget));
      if (progress < 1) rafRef.current = requestAnimationFrame(tick);
    };
    setDisplay(0);
    rafRef.current = requestAnimationFrame(tick);

    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, [safeTarget, durationMs, reduceMotion]);

  return display;
}
