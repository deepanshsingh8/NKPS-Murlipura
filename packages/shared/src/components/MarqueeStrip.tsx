"use client";

import { cn } from "@nkps/shared/lib/utils";

interface MarqueeStripProps {
  items: string[];
  className?: string;
  reverse?: boolean;
}

export function MarqueeStrip({
  items,
  className,
  reverse = false,
}: MarqueeStripProps) {
  const content = items.map((item) => item).join(" \u2022 ") + " \u2022 ";

  return (
    <div className={cn("group/marquee overflow-hidden whitespace-nowrap", className)}>
      <div
        className={cn(
          "inline-flex animate-marquee group-hover/marquee:[animation-play-state:paused]",
          reverse && "[animation-direction:reverse]"
        )}
      >
        <span className="inline-block text-sm font-medium uppercase tracking-[0.2em] px-4 transition-opacity duration-300 group-hover/marquee:opacity-80">
          {content}
        </span>
        <span className="inline-block text-sm font-medium uppercase tracking-[0.2em] px-4 transition-opacity duration-300 group-hover/marquee:opacity-80">
          {content}
        </span>
      </div>
    </div>
  );
}
