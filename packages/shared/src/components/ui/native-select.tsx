import * as React from "react"

import { cn } from "@nkps/shared/lib/utils"

// The chevron, drawn as a background image rather than a sibling element.
//
// A wrapper <div> would have been tidier to write, but these selects sit in
// flex toolbars and grid cells that size around the control itself, and
// introducing a block-level parent changes that layout at ~40 call sites.
// This way <select> → <NativeSelect> is a drop-in: same element, same box,
// same position in the tree.
//
// slate-400 reads correctly against both the light and the dark surface, so
// one colour serves both themes.
const CHEVRON =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%2394a3b8' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E\")"

// A native <select> wearing the same clothes as the rest of the form.
//
// There were ~40 raw <select> elements in the ERP, each carrying its own
// hand-written `h-9 … text-sm`. Every one was 36px tall — under the 44px
// touch minimum — at 14px, which is under the 16px threshold at which iOS
// zooms the viewport on focus and then declines to zoom back out.
//
// These stay *native* rather than becoming the base-ui Select: converting
// means restructuring value/onChange and every <option> into SelectItem
// children at 40 call sites, and on a phone a native select is the better
// control anyway — it opens the platform picker, a wheel the thumb already
// knows, instead of a listbox rendered inside a scrolling sheet.
function NativeSelect({
  className,
  style,
  children,
  ...props
}: React.ComponentProps<"select">) {
  return (
    <select
      data-slot="native-select"
      style={{
        backgroundImage: CHEVRON,
        backgroundPosition: "right 0.5rem center",
        backgroundRepeat: "no-repeat",
        backgroundSize: "1rem 1rem",
        ...style,
      }}
      className={cn(
        // Heights and font size track Input's h-11 sm:h-8 / text-base
        // md:text-sm exactly, so a select and an input side by side line up
        // and neither of them trips the iOS zoom.
        "h-11 min-w-0 appearance-none rounded-lg border border-input bg-transparent py-1 pr-8 pl-2.5 text-base transition-colors outline-none",
        "focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50",
        "disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50",
        "aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20",
        "dark:bg-input/30 dark:hover:bg-input/50 dark:aria-invalid:border-destructive/50",
        "sm:h-8 md:text-sm",
        className
      )}
      {...props}
    >
      {children}
    </select>
  )
}

export { NativeSelect }
