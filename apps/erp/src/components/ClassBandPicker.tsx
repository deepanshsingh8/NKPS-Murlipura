"use client";

import { CLASS_ORDER } from "@nkps/shared/lib/constants";
import { cn } from "@nkps/shared/lib/utils";

/**
 * Which classes a wing covers.
 *
 * Names, not ids, because classes are per-academic-year rows and a wing has to
 * outlive the rollover — so the band is `{'VI','VII','VIII'}` and resolves to
 * whatever classes carry those names in whichever year you apply it to.
 *
 * `CLASS_ORDER` (packages/shared/src/lib/constants.ts) is the source of truth
 * for the vocabulary and the ordering; sorting these as text puts X before XI
 * but after VIII, which looks right often enough to be missed.
 *
 * Each name shows how many classes actually exist in the chosen year, so a
 * band that would apply to nothing is visible before it is saved rather than
 * after the apply reports zero.
 */
export function ClassBandPicker({
  value,
  onChange,
  sectionCounts,
}: {
  value: string[];
  onChange: (next: string[]) => void;
  /** class name → number of sections in the current year. */
  sectionCounts: Map<string, number>;
}) {
  const toggle = (name: string) => {
    onChange(
      value.includes(name)
        ? value.filter((n) => n !== name)
        : // Keep the stored band in curriculum order, so it reads as a band
          // ("VI, VII, VIII") rather than in click order.
          CLASS_ORDER.filter((n) => n === name || value.includes(n))
    );
  };

  return (
    <div className="flex flex-wrap gap-1.5">
      {CLASS_ORDER.map((name) => {
        const on = value.includes(name);
        const count = sectionCounts.get(name) ?? 0;
        return (
          <button
            key={name}
            type="button"
            onClick={() => toggle(name)}
            className={cn(
              "rounded-lg border px-2.5 py-1.5 text-left text-xs transition-colors",
              on
                ? "border-green-400 bg-green-50 text-green-800 dark:border-green-700 dark:bg-green-950/30 dark:text-green-300"
                : "border-gray-200 text-gray-600 hover:bg-gray-50 dark:border-border dark:text-gray-300 dark:hover:bg-muted"
            )}
          >
            <span className="font-medium">{name}</span>
            <span
              className={cn(
                "ml-1.5",
                count === 0
                  ? "text-amber-600 dark:text-amber-400"
                  : "text-gray-400 dark:text-gray-500"
              )}
            >
              {count === 0
                ? "none"
                : `${count} section${count === 1 ? "" : "s"}`}
            </span>
          </button>
        );
      })}
    </div>
  );
}
