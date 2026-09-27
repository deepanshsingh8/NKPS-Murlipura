"use client";

import { useCallback, useRef, useState } from "react";

import { useMediaQuery } from "@nkps/shared/hooks/useMediaQuery";

/** Past this many px, releasing dismisses rather than snapping back. */
const DISMISS_OFFSET_PX = 110;
/** A fast flick dismisses from anywhere. px per ms, downward. */
const DISMISS_VELOCITY = 0.6;
/** Dragging up past the top resists instead of stopping dead. */
const RUBBER_BAND = 0.35;

export interface SheetResize {
  /** Current height in px. */
  height: number;
  /** Called continuously during the drag. */
  onHeight: (px: number) => void;
  min: number;
  max: number;
}

/**
 * Drag a bottom sheet with a thumb: down to dismiss, and — where the sheet
 * can be resized — up and down to change its height.
 *
 * The dialog already draws a grab handle on phones, and it was decorative:
 * the affordance every native sheet has, attached to nothing. People pull it
 * and the sheet ignores them, which is worse than not drawing it.
 *
 * The gesture lives on the HANDLE (and any header it is given to), never on
 * the sheet body. A sheet's body scrolls, and a drag that starts there has to
 * guess continuously whether the user meant to scroll the content or move the
 * sheet — the guess is wrong often enough to feel broken. Every native sheet
 * with a scrolling body does it this way for the same reason.
 *
 * Pointer events rather than framer-motion because the dialog's open/close is
 * CSS-animated through base-ui's data-attributes; a motion component wrapping
 * it would own the transform and fight those keyframes.
 */
export function useSheetDrag({
  onDismiss,
  resize,
  enabled = true,
}: {
  onDismiss: () => void;
  resize?: SheetResize;
  enabled?: boolean;
}) {
  // Only below `sm`, where the dialog is a sheet. Above it the panel is a
  // centred card positioned with a transform this would overwrite.
  const isSheet = useMediaQuery("(max-width: 639px)");
  const active = enabled && isSheet;

  const [offset, setOffset] = useState(0);
  const [dragging, setDragging] = useState(false);

  const start = useRef({ y: 0, height: 0, t: 0, lastY: 0, lastT: 0 });

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (!active || e.button !== 0) return;
      e.currentTarget.setPointerCapture(e.pointerId);
      const now = performance.now();
      start.current = {
        y: e.clientY,
        height: resize?.height ?? 0,
        t: now,
        lastY: e.clientY,
        lastT: now,
      };
      setDragging(true);
    },
    [active, resize?.height]
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!dragging) return;
      const dy = e.clientY - start.current.y;
      start.current.lastY = e.clientY;
      start.current.lastT = performance.now();

      if (resize) {
        // Up (negative dy) grows the sheet. Once it is back to its minimum,
        // further downward drag stops resizing and starts dismissing, so one
        // continuous pull shrinks the sheet and then throws it away.
        const wanted = start.current.height - dy;
        const clamped = Math.min(resize.max, Math.max(resize.min, wanted));
        if (clamped !== resize.height) resize.onHeight(clamped);
        setOffset(wanted < resize.min ? resize.min - wanted : 0);
        return;
      }

      // No resize: the sheet only moves down. Upward drag rubber-bands so the
      // gesture still responds rather than feeling stuck.
      setOffset(dy >= 0 ? dy : dy * RUBBER_BAND);
    },
    [dragging, resize]
  );

  const finish = useCallback(() => {
    if (!dragging) return;
    setDragging(false);
    const { lastY, y, lastT, t } = start.current;
    const elapsed = Math.max(1, lastT - t);
    const velocity = (lastY - y) / elapsed;
    const far = offset > DISMISS_OFFSET_PX;
    const flicked = velocity > DISMISS_VELOCITY && offset > 24;
    setOffset(0);
    if (far || flicked) onDismiss();
  }, [dragging, offset, onDismiss]);

  return {
    /** Spread onto the grab handle (and a header, if it should drag too). */
    handleProps: active
      ? {
          onPointerDown,
          onPointerMove,
          onPointerUp: finish,
          onPointerCancel: finish,
          // The handle must not scroll the page or select text mid-drag.
          style: { touchAction: "none" as const, cursor: "grab" },
        }
      : {},
    /** Spread onto the sheet itself. */
    sheetStyle: active
      ? {
          transform: offset ? `translateY(${offset}px)` : undefined,
          // Snapping back is animated; following the finger is not.
          transition: dragging ? "none" : undefined,
        }
      : {},
    dragging,
    /** True below `sm`, where the gesture applies at all. */
    isSheet,
  };
}
