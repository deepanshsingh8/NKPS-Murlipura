"use client";

import { cn } from "@nkps/shared/lib/utils";
import { usePrefersReducedMotion } from "@nkps/shared/hooks/useMediaQuery";

// A 12-ish point trend line for a stat tile. Not a chart in its own right — it
// is the "is this going up or down" channel beside a number, which is why it
// has no axes, no gridlines and no tooltip.
//
// Mark spec: 2px line with round joins, an area wash at ~10%, and an end marker
// of r>=4 carrying a 2px ring in the surface colour so it stays legible where it
// crosses the line. History is drawn in the de-emphasis hue and only the current
// point wears the accent — the sparkline's job is "where did it end up", and
// colouring the whole line accent makes the endpoint disappear into it.
//
// Colour comes from the parent via `currentColor`, so a tile that is blue makes
// a blue sparkline and dark mode needs no second palette.

export interface SparklineProps {
  values: number[];
  /** Drawn behind the line at ~10% opacity. Off for very short series. */
  area?: boolean;
  className?: string;
  /** Surface colour for the end-marker ring — must match the card behind it. */
  ringClassName?: string;
  ariaLabel?: string;
}

const W = 100;
const H = 28;
const PAD = 3;

export function Sparkline({
  values,
  area = true,
  className,
  ringClassName = "fill-white dark:fill-card",
  ariaLabel,
}: SparklineProps) {
  const reduceMotion = usePrefersReducedMotion();
  const clean = values.filter((v) => Number.isFinite(v));
  // Two points is the minimum that can express a direction; below that the
  // honest thing is to draw nothing rather than a flat line implying stability.
  if (clean.length < 2) return null;

  const min = Math.min(...clean);
  const max = Math.max(...clean);
  // A perfectly flat series would divide by zero; draw it down the middle.
  const span = max - min || 1;
  const step = (W - PAD * 2) / (clean.length - 1);

  const points = clean.map((v, i) => {
    const x = PAD + i * step;
    const y = PAD + (H - PAD * 2) * (1 - (v - min) / span);
    return [x, y] as const;
  });

  const line = points.map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`).join(" ");
  const [lastX, lastY] = points[points.length - 1];

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      className={cn("h-7 w-full overflow-visible", className)}
      role="img"
      aria-label={ariaLabel}
    >
      {area && (
        <polygon
          points={`${PAD},${H} ${line} ${(W - PAD).toFixed(2)},${H}`}
          className="fill-current opacity-10"
        />
      )}
      <polyline
        points={line}
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinejoin="round"
        strokeLinecap="round"
        // vectorEffect keeps the stroke 2px after the non-uniform scale that
        // preserveAspectRatio="none" applies — without it the line thickens
        // horizontally and thins vertically as the tile changes width.
        vectorEffect="non-scaling-stroke"
        className={cn("opacity-45", !reduceMotion && "transition-opacity")}
      />
      <circle cx={lastX} cy={lastY} r={4.5} className={ringClassName} />
      <circle cx={lastX} cy={lastY} r={2.5} className="fill-current" />
    </svg>
  );
}
