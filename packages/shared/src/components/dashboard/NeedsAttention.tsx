"use client";

import Link from "next/link";
import { ArrowRight, CheckCircle2, type LucideIcon } from "lucide-react";
import { cn } from "@nkps/shared/lib/utils";

// The queues someone has to clear, pulled above the fold.
//
// These counts already existed — as small red badges on sidebar links, which is
// to say behind a hamburger on a phone. A pending registration that nobody has
// opened the menu to notice is the same as no notification at all.
//
// Rows, not tiles: each one is a thing to go and do, and a row has space for the
// verb ("3 families waiting on a decision") that a tile does not.

export interface AttentionItem {
  key: string;
  label: string;
  /** What the number means, in words. Shown under the label. */
  detail: string;
  count: number;
  href: string;
  icon: LucideIcon;
}

export function NeedsAttention({
  items,
  loading,
}: {
  items: AttentionItem[];
  loading: boolean;
}) {
  const live = items.filter((i) => i.count > 0);

  if (loading) {
    return (
      <div className="space-y-2">
        {[0, 1].map((i) => (
          <div
            key={i}
            className="h-16 animate-pulse rounded-xl border border-gray-200/80 bg-white dark:border-border dark:bg-card"
          />
        ))}
      </div>
    );
  }

  // Nothing outstanding is worth saying out loud — an empty space reads as a
  // section that failed to load.
  if (live.length === 0) {
    return (
      <div className="flex items-center gap-2.5 rounded-xl border border-green-200/70 bg-green-50/60 px-4 py-3 dark:border-green-900/40 dark:bg-green-900/15">
        <CheckCircle2 className="h-4 w-4 shrink-0 text-green-600 dark:text-green-400" />
        <p className="text-sm text-green-800 dark:text-green-300">
          Nothing is waiting on you.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {live.map(({ key, label, detail, count, href, icon: Icon }) => (
        <Link
          key={key}
          href={href}
          className={cn(
            "flex items-center gap-3 rounded-xl border border-amber-200/70 bg-amber-50/60 px-3 py-3 transition-colors",
            "hover:border-amber-300 active:scale-[0.99] dark:border-amber-500/25 dark:bg-amber-500/10"
          )}
        >
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-amber-100 dark:bg-amber-500/20">
            <Icon className="h-4 w-4 text-amber-700 dark:text-amber-400" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-semibold text-navy-900 dark:text-white">
              {count > 99 ? "99+" : count} {label}
            </span>
            <span className="block truncate text-xs text-gray-500 dark:text-gray-400">
              {detail}
            </span>
          </span>
          <ArrowRight className="h-4 w-4 shrink-0 text-amber-700/60 dark:text-amber-400/60" />
        </Link>
      ))}
    </div>
  );
}
