"use client";

import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import { cn } from "@nkps/shared/lib/utils";

// "+12 vs last month". Signed, always named against a period, and never colour
// alone — the arrow carries the direction for anyone who cannot separate the
// green from the red.
//
// `upIsGood` exists because direction and sentiment are not the same thing. More
// admissions is good; more students with dues is not. Callers say which.

export function DeltaBadge({
  value,
  period,
  upIsGood = true,
  className,
}: {
  /** The change itself, not the new total. */
  value: number;
  /** e.g. "vs last month" — shown beside the number, never implied. */
  period?: string;
  upIsGood?: boolean;
  className?: string;
}) {
  if (!Number.isFinite(value)) return null;

  const flat = value === 0;
  const up = value > 0;
  const good = flat ? null : up === upIsGood;
  const Icon = flat ? Minus : up ? ArrowUpRight : ArrowDownRight;

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 text-[11px] font-medium",
        good === null
          ? "text-gray-500 dark:text-gray-400"
          : good
            ? "text-green-700 dark:text-green-400"
            : "text-red-700 dark:text-red-400",
        className
      )}
    >
      <Icon className="h-3 w-3 shrink-0" />
      <span className="tabular-nums">
        {up ? "+" : ""}
        {value.toLocaleString("en-IN")}
      </span>
      {period && (
        <span className="font-normal text-gray-500 dark:text-gray-400">
          {period}
        </span>
      )}
    </span>
  );
}
