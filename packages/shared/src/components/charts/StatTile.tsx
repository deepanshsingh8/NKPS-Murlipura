"use client";

import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import { cn } from "@nkps/shared/lib/utils";
import { Sparkline } from "@nkps/shared/components/charts/Sparkline";
import { Meter, type MeterTone } from "@nkps/shared/components/charts/Meter";
import { DeltaBadge } from "@nkps/shared/components/charts/DeltaBadge";
import { useCountUp } from "@nkps/shared/components/charts/useCountUp";

// The stat-tile contract: a label, a value, and — where the data supports it —
// one signal of movement (a delta, a trend line, or a meter). Never more than
// one: the tile's job is a number you can read in a glance, and three competing
// signals is a chart pretending to be a tile.

/** 1,284 · 12.9K · 4.2L. Compacts only where the digits stop being readable. */
export function compactNumber(value: number): string {
  if (!Number.isFinite(value)) return "—";
  const abs = Math.abs(value);
  // Indian numbering: a school talks in lakhs long before it talks in millions.
  if (abs >= 10_000_000) return `${(value / 10_000_000).toFixed(1)}Cr`;
  if (abs >= 100_000) return `${(value / 100_000).toFixed(1)}L`;
  return value.toLocaleString("en-IN");
}

export interface StatTileProps {
  label: string;
  value: number;
  icon: LucideIcon;
  /** Tailwind text colour for the icon and any trend line drawn under it. */
  tone: string;
  iconBg: string;
  href?: string;
  loading?: boolean;
  /** 2+ points renders a trend line under the value. */
  trend?: number[];
  delta?: { value: number; period: string; upIsGood?: boolean };
  meter?: { percent: number; tone: MeterTone; caption: string };
  /** Rendered smaller, immediately after the value — "%", "days". */
  unit?: string;
  /** Draws attention to a queue that needs clearing. */
  urgent?: boolean;
  className?: string;
  style?: React.CSSProperties;
}

export function StatTile({
  label,
  value,
  icon: Icon,
  tone,
  iconBg,
  href,
  loading = false,
  trend,
  delta,
  meter,
  unit,
  urgent = false,
  className,
  style,
}: StatTileProps) {
  const counted = useCountUp(value);

  const body = (
    <>
      <div className="flex items-start gap-3">
        <div
          className={cn(
            "flex h-9 w-9 shrink-0 items-center justify-center rounded-xl",
            iconBg
          )}
        >
          <Icon className={cn("h-4.5 w-4.5", tone)} />
        </div>
        <div className="min-w-0 flex-1">
          {loading ? (
            <div className="h-7 w-14 animate-pulse rounded-lg bg-gray-100 dark:bg-muted" />
          ) : (
            // Proportional figures, not tabular: at this size equal-width
            // digits make a number like 121 look loose and gappy.
            <p className="font-sans text-2xl font-semibold leading-none tracking-tight text-navy-900 dark:text-white">
              {compactNumber(counted)}
              {unit && (
                <span className="ml-0.5 text-base font-medium text-gray-400 dark:text-gray-500">
                  {unit}
                </span>
              )}
            </p>
          )}
          {/* Wraps to a second line rather than truncating: at two-up on a
              phone these tiles are ~165px wide, and a clipped "Attendance th…"
              tells the reader nothing. */}
          <p className="mt-1.5 line-clamp-2 text-xs leading-snug text-gray-500 dark:text-gray-400">
            {label}
          </p>
        </div>
      </div>

      {!loading && trend && trend.length >= 2 && (
        <div className={cn("mt-3", tone)}>
          <Sparkline values={trend} ariaLabel={`${label} trend`} />
        </div>
      )}

      {!loading && meter && (
        <div className="mt-3 space-y-1.5">
          <Meter
            percent={meter.percent}
            tone={meter.tone}
            ariaLabel={`${label}: ${Math.round(meter.percent)}%`}
          />
          <p className="text-[11px] text-gray-500 dark:text-gray-400">
            {meter.caption}
          </p>
        </div>
      )}

      {!loading && delta && !meter && (
        <div className="mt-2.5">
          <DeltaBadge
            value={delta.value}
            period={delta.period}
            upIsGood={delta.upIsGood}
          />
        </div>
      )}
    </>
  );

  const shell = cn(
    "rounded-2xl border bg-white p-4 shadow-sm transition-all duration-200 dark:bg-card",
    urgent
      ? "border-amber-300/70 dark:border-amber-500/30"
      : "border-gray-200/80 dark:border-border",
    href && "active:scale-[0.99] hover:shadow-md",
    className
  );

  if (loading || !href) {
    return (
      <div className={shell} style={style}>
        {body}
      </div>
    );
  }

  return (
    <Link
      href={href}
      className={cn(
        shell,
        "block focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-background"
      )}
      style={style}
    >
      {body}
    </Link>
  );
}
