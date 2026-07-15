"use client";

import { useEffect, useRef, useState } from "react";
import { useInView } from "framer-motion";
import { cn } from "@nkps/shared/lib/utils";

interface CounterAnimationProps {
  end: number;
  suffix?: string;
  label: string;
  light?: boolean;
  /**
   * When set, this string is shown verbatim instead of the count-up animation.
   * Use for values that read as an identifier rather than a quantity — e.g. a
   * founding year like "1985", which would otherwise roll 0 → 1985.
   */
  display?: string;
}

export function CounterAnimation({ end, suffix = "", label, light, display }: CounterAnimationProps) {
  const ref = useRef<HTMLDivElement>(null);
  const isInView = useInView(ref, { once: true, margin: "-100px" });
  const [count, setCount] = useState(0);

  useEffect(() => {
    if (!isInView || display != null) return;

    const duration = 2000;
    const startTime = performance.now();

    function animate(currentTime: number) {
      const elapsed = currentTime - startTime;
      const progress = Math.min(elapsed / duration, 1);

      // Ease out cubic
      const eased = 1 - Math.pow(1 - progress, 3);
      setCount(Math.floor(eased * end));

      if (progress < 1) {
        requestAnimationFrame(animate);
      }
    }

    requestAnimationFrame(animate);
  }, [isInView, end]);

  return (
    <div ref={ref} className="text-center">
      <div
        className={cn(
          "text-4xl md:text-5xl font-bold font-heading",
          light ? "text-white" : "text-navy-900"
        )}
      >
        {display ?? `${count}${suffix}`}
      </div>
      <div
        className={cn(
          "text-sm uppercase tracking-wider mt-2",
          light ? "text-gray-300" : "text-gray-600"
        )}
      >
        {label}
      </div>
    </div>
  );
}
