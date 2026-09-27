import * as React from "react"

import { cn } from "@nkps/shared/lib/utils"

// The form layout primitives the repo did not have.
//
// Every field in this codebase was hand-assembled as
//   <div className="grid grid-cols-2 gap-3">
//     <div className="space-y-1"><Label/><input/></div>
//
// which is why the same two mobile bugs appeared ~80 times and there was
// nowhere to fix them once:
//
//  1. `grid-cols-2` with no breakpoint puts two controls in ~343px of sheet.
//     A native date input will not render that narrow, so it overflows its
//     track and lands on top of its neighbour.
//  2. A grid child defaults to `min-width: auto`, so it *cannot* shrink below
//     its content — the column refuses to give, and the overflow goes sideways
//     instead of the text wrapping.
//
// FieldRow fixes both for everything inside it. Use it instead of writing a
// grid by hand; scripts/check-mobile-layout.mjs enforces that.

type FieldRowProps = React.ComponentProps<"div"> & {
  /** Columns from `sm` up. Below `sm` it is always one. */
  cols?: 2 | 3
}

function FieldRow({ className, cols = 2, ...props }: FieldRowProps) {
  return (
    <div
      data-slot="field-row"
      className={cn(
        "grid grid-cols-1 gap-3 [&>*]:min-w-0",
        cols === 3 ? "sm:grid-cols-2 lg:grid-cols-3" : "sm:grid-cols-2",
        className
      )}
      {...props}
    />
  )
}

// One label + control + optional hint. `min-w-0` is the load-bearing part;
// the descendant rules make controls fill the cell so a Select and an Input
// sitting side by side are the same width, which they were not before.
function Field({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="field"
      className={cn(
        "min-w-0 space-y-1.5",
        "[&_[data-slot=select-trigger]]:w-full [&_[data-slot=input]]:w-full",
        "[&_input]:w-full [&_select]:w-full [&_textarea]:w-full",
        className
      )}
      {...props}
    />
  )
}

// The explanatory line under a control ("Blank = the late fee starts on the
// due date."). Was written inline as a bare <p> with varying classes.
function FieldHint({ className, ...props }: React.ComponentProps<"p">) {
  return (
    <p
      data-slot="field-hint"
      className={cn(
        "text-xs leading-snug text-gray-500 dark:text-gray-400",
        className
      )}
      {...props}
    />
  )
}

function FieldError({ className, ...props }: React.ComponentProps<"p">) {
  return (
    <p
      data-slot="field-error"
      role="alert"
      className={cn("text-xs leading-snug text-destructive", className)}
      {...props}
    />
  )
}

export { Field, FieldError, FieldHint, FieldRow }
