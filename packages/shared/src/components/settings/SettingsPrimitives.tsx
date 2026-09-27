"use client";

import { cn } from "@nkps/shared/lib/utils";

// The furniture every settings screen is made of: a titled group of rows, and
// a row that is a label with something on the right.
//
// Grouped cards rather than one long form. A form asks you to fill it in; a
// settings screen is a list of things that are each already set to something,
// and the grouped-list idiom is what people have been reading on a phone for
// fifteen years.

export function SettingsGroup({
  title,
  description,
  icon: Icon,
  children,
  id,
}: {
  title: string;
  description?: string;
  icon?: React.ComponentType<{ className?: string }>;
  children: React.ReactNode;
  id?: string;
}) {
  return (
    <section id={id} className="scroll-mt-20">
      <div className="mb-2.5 flex items-center gap-2 px-1">
        {Icon && <Icon className="h-4 w-4 shrink-0 text-gray-400" />}
        <h2 className="font-heading text-base font-semibold text-navy-900 dark:text-white">
          {title}
        </h2>
      </div>
      {description && (
        <p className="mb-2.5 px-1 text-xs text-gray-500 dark:text-gray-400">
          {description}
        </p>
      )}
      <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm dark:border-border dark:bg-card">
        {children}
      </div>
    </section>
  );
}

/** A single row. `control` sits on the right on wide rows, underneath on narrow. */
export function SettingsRow({
  label,
  hint,
  control,
  stacked = false,
  className,
}: {
  label: React.ReactNode;
  hint?: React.ReactNode;
  control?: React.ReactNode;
  /** Put the control on its own line — for anything wider than a switch. */
  stacked?: boolean;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "border-b border-gray-100 px-4 py-3.5 last:border-b-0 dark:border-border/70",
        className
      )}
    >
      <div
        className={cn(
          stacked ? "space-y-2.5" : "flex items-center justify-between gap-4"
        )}
      >
        <div className="min-w-0">
          <p className="text-sm font-medium text-navy-900 dark:text-white">
            {label}
          </p>
          {hint && (
            <p className="mt-0.5 text-xs leading-snug text-gray-500 dark:text-gray-400">
              {hint}
            </p>
          )}
        </div>
        {control && <div className={stacked ? "" : "shrink-0"}>{control}</div>}
      </div>
    </div>
  );
}

/**
 * An on/off switch.
 *
 * Hand-rolled because the shadcn set in this repo has no Switch — and a
 * checkbox reads as "tick this to agree", where a switch reads as "this is on".
 * Built on a real <button role="switch"> so it is keyboard- and
 * screen-reader-correct rather than a styled div.
 */
export function SettingsSwitch({
  checked,
  onChange,
  label,
  disabled = false,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition-colors",
        "focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-card",
        disabled && "cursor-not-allowed opacity-50",
        checked
          ? "bg-navy-900 dark:bg-gold-500"
          : "bg-gray-200 dark:bg-muted"
      )}
    >
      <span
        className={cn(
          "inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform dark:bg-navy-900",
          checked ? "translate-x-6" : "translate-x-1"
        )}
      />
    </button>
  );
}
