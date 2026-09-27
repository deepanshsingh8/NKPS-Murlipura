"use client";

import { Monitor, Moon, Sun } from "lucide-react";
import { cn } from "@nkps/shared/lib/utils";
import { useTheme, type Theme } from "@nkps/shared/components/providers/ThemeProvider";

const OPTIONS: { value: Theme; label: string; icon: typeof Sun }[] = [
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
  { value: "system", label: "System", icon: Monitor },
];

/**
 * Three-way theme control.
 *
 * Two tones because it has two homes with opposite grounds: the sidebar, which
 * is navy in both themes, and ordinary page surfaces, which are not. A single
 * set of classes would be unreadable in one of them.
 *
 * "System" is a real third state, not a computed one — a user who picks it is
 * saying "follow my phone", which keeps working when their phone switches at
 * sunset. Collapsing it to a light/dark toggle would throw that away.
 */
export function ThemeToggle({
  tone = "surface",
  className,
}: {
  tone?: "surface" | "sidebar";
  className?: string;
}) {
  const { theme, setTheme, hydrated } = useTheme();
  const onSidebar = tone === "sidebar";

  return (
    <div
      role="radiogroup"
      aria-label="Colour theme"
      className={cn(
        "flex items-center gap-1 rounded-xl p-1",
        onSidebar ? "bg-white/5" : "bg-gray-100 dark:bg-muted",
        className
      )}
    >
      {OPTIONS.map(({ value, label, icon: Icon }) => {
        // Until the stored preference has been read, nothing is selected —
        // better than confidently highlighting "Light" and then jumping.
        const selected = hydrated && theme === value;
        return (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => setTheme(value)}
            className={cn(
              "flex flex-1 items-center justify-center gap-1.5 rounded-lg px-2.5 py-2 text-xs font-medium transition-colors",
              selected
                ? onSidebar
                  ? "bg-white/15 text-white"
                  : "bg-white text-navy-900 shadow-sm dark:bg-card dark:text-white"
                : onSidebar
                  ? "text-white/60 hover:text-white"
                  : "text-gray-500 hover:text-navy-900 dark:text-gray-400 dark:hover:text-white"
            )}
          >
            <Icon className="h-3.5 w-3.5 shrink-0" />
            <span>{label}</span>
          </button>
        );
      })}
    </div>
  );
}
