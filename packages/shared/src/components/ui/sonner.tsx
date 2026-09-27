"use client"

import { Toaster as Sonner, type ToasterProps } from "sonner"
import { CircleCheckIcon, InfoIcon, TriangleAlertIcon, OctagonXIcon, Loader2Icon } from "lucide-react"
import { useTheme } from "@nkps/shared/components/providers/ThemeProvider"

// Toasts are pinned to the top of the screen, so a light toast layer over a
// dark app is the most visible way for the theme to be half-applied — and
// `theme="light"` was hard-coded here, which is exactly what happened.
//
// The style block below already mapped the plain toast to --popover, so a
// default toast looked right; but sonner's own `theme` drives the richColors
// success/warning/error palettes and the close button, and those stayed light.
//
// useTheme() falls back to "light" without a provider, which is what
// apps/website wants — it has no ThemeProvider and is light-only by design.
const Toaster = ({ ...props }: ToasterProps) => {
  const { resolvedTheme } = useTheme()
  return (
    <Sonner
      theme={resolvedTheme}
      className="toaster group"
      icons={{
        success: (
          <CircleCheckIcon className="size-4" />
        ),
        info: (
          <InfoIcon className="size-4" />
        ),
        warning: (
          <TriangleAlertIcon className="size-4" />
        ),
        error: (
          <OctagonXIcon className="size-4" />
        ),
        loading: (
          <Loader2Icon className="size-4 animate-spin" />
        ),
      }}
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--border)",
          "--border-radius": "var(--radius)",
        } as React.CSSProperties
      }
      toastOptions={{
        classNames: {
          toast: "cn-toast",
        },
      }}
      {...props}
    />
  )
}

export { Toaster }
