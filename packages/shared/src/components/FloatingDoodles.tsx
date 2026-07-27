"use client";

import {
  motion,
  useMotionValue,
  useMotionValueEvent,
  useReducedMotion,
  useSpring,
  useTransform,
  type MotionValue,
} from "framer-motion";
import { useEffect, useRef } from "react";
import {
  Atom,
  BookOpen,
  Calculator,
  Compass,
  Dna,
  FlaskConical,
  Globe,
  GraduationCap,
  Lightbulb,
  Microscope,
  Music,
  NotebookPen,
  PenTool,
  Pencil,
  Rocket,
  Ruler,
  Send,
  Sigma,
  Star,
  Telescope,
  type LucideIcon,
} from "lucide-react";
import { useMouseMotion } from "@nkps/shared/hooks/useMousePosition";
import { cn } from "@nkps/shared/lib/utils";

interface Doodle {
  Icon: LucideIcon;
  /** Position as % of the container. */
  top: number;
  left: number;
  /** Icon size in px (desktop). */
  size: number;
  /** Initial rotation (deg). */
  rotate: number;
  /** Parallax depth 0..1 — larger = moves more (closer to viewer). */
  depth: number;
  /** Idle float duration (s). */
  duration: number;
  /** Hide on small screens to avoid clutter. */
  hideOnMobile?: boolean;
}

// A hand-tuned scatter that favours the edges/corners so doodles sit in the
// empty margins around centred content rather than behind text.
const DOODLES: Doodle[] = [
  { Icon: FlaskConical, top: 12, left: 5, size: 46, rotate: -12, depth: 0.9, duration: 7 },
  { Icon: GraduationCap, top: 8, left: 88, size: 52, rotate: 10, depth: 1, duration: 8 },
  { Icon: BookOpen, top: 52, left: 7, size: 48, rotate: -6, depth: 0.75, duration: 9, hideOnMobile: true },
  { Icon: Compass, top: 30, left: 93, size: 40, rotate: 18, depth: 0.6, duration: 10, hideOnMobile: true },
  { Icon: Lightbulb, top: 74, left: 12, size: 38, rotate: 8, depth: 0.85, duration: 7.5 },
  { Icon: Atom, top: 18, left: 68, size: 34, rotate: 0, depth: 0.5, duration: 11, hideOnMobile: true },
  { Icon: Pencil, top: 40, left: 40, size: 30, rotate: 45, depth: 0.4, duration: 12, hideOnMobile: true },
  { Icon: Sigma, top: 82, left: 82, size: 36, rotate: -8, depth: 0.7, duration: 8.5 },
  { Icon: Ruler, top: 88, left: 45, size: 40, rotate: 24, depth: 0.55, duration: 10.5, hideOnMobile: true },
  { Icon: Send, top: 62, left: 90, size: 38, rotate: -18, depth: 0.95, duration: 7, hideOnMobile: true },
  { Icon: Globe, top: 66, left: 55, size: 32, rotate: 6, depth: 0.35, duration: 13, hideOnMobile: true },
  { Icon: Star, top: 24, left: 22, size: 26, rotate: -20, depth: 0.65, duration: 9.5 },
  { Icon: Microscope, top: 46, left: 78, size: 42, rotate: 12, depth: 0.8, duration: 8, hideOnMobile: true },
  { Icon: Calculator, top: 92, left: 24, size: 34, rotate: -10, depth: 0.5, duration: 11.5, hideOnMobile: true },
  { Icon: Telescope, top: 6, left: 46, size: 34, rotate: 14, depth: 0.6, duration: 10, hideOnMobile: true },
  { Icon: Music, top: 34, left: 14, size: 28, rotate: 16, depth: 0.45, duration: 12.5, hideOnMobile: true },
  { Icon: Rocket, top: 70, left: 34, size: 34, rotate: -24, depth: 0.7, duration: 9, hideOnMobile: true },
  { Icon: PenTool, top: 14, left: 34, size: 28, rotate: 30, depth: 0.4, duration: 13.5, hideOnMobile: true },
  { Icon: Dna, top: 56, left: 24, size: 30, rotate: -14, depth: 0.55, duration: 11, hideOnMobile: true },
  { Icon: NotebookPen, top: 80, left: 66, size: 34, rotate: 8, depth: 0.85, duration: 8.5, hideOnMobile: true },
];

// Cursor "makes space": doodles within this radius (px) of the cursor are pushed
// away, springing back once it leaves.
const REPEL_RADIUS = 200;
const REPEL_STRENGTH = 90; // max push (px) at the cursor, scaled by depth.
const DRIFT_AMOUNT = 22; // subtle whole-layer parallax travel (px), scaled by depth.

interface FloatingDoodlesProps {
  /**
   * "light" tints for dark backgrounds (lighter blue), "dark" tints for light
   * backgrounds (deeper blue). Default "dark".
   */
  tone?: "light" | "dark";
  /** Number of doodles to render (from the curated list). Default 14. */
  count?: number;
  /**
   * When true the layer is pinned to the viewport (`fixed`, behind all content)
   * instead of filling its nearest positioned ancestor. Used for the single
   * site-wide ambient layer that shows through the page's open cream space.
   */
  fixed?: boolean;
  /** Extra classes on the layer wrapper. */
  className?: string;
}

/** Shared pointer position in viewport pixels (-9999 when the cursor has left). */
function usePointer() {
  const px = useMotionValue(-9999);
  const py = useMotionValue(-9999);

  useEffect(() => {
    function move(e: MouseEvent) {
      px.set(e.clientX);
      py.set(e.clientY);
    }
    function leave() {
      px.set(-9999);
      py.set(-9999);
    }
    window.addEventListener("mousemove", move, { passive: true });
    document.addEventListener("mouseleave", leave);
    return () => {
      window.removeEventListener("mousemove", move);
      document.removeEventListener("mouseleave", leave);
    };
  }, [px, py]);

  return { px, py };
}

function ParallaxDoodle({
  doodle,
  tone,
  reduced,
  driftX,
  driftY,
  px,
  py,
  rectRef,
}: {
  doodle: Doodle;
  tone: "light" | "dark";
  reduced: boolean;
  driftX: MotionValue<number>;
  driftY: MotionValue<number>;
  px: MotionValue<number>;
  py: MotionValue<number>;
  /** Live viewport rect of the layer, measured once per layer (not per icon). */
  rectRef: { current: DOMRect | null };
}) {
  // Repulsion target (raw) → spring (smooth "make space / snap back").
  const repelX = useMotionValue(0);
  const repelY = useMotionValue(0);
  const springX = useSpring(repelX, { stiffness: 140, damping: 15, mass: 0.4 });
  const springY = useSpring(repelY, { stiffness: 140, damping: 15, mass: 0.4 });

  // Final translate = global drift (depth parallax) + local cursor repulsion.
  const drift = doodle.depth * DRIFT_AMOUNT;
  const x = useTransform(
    [driftX, springX] as MotionValue[],
    ([d, r]: number[]) => (reduced ? 0 : -d * drift + r)
  );
  const y = useTransform(
    [driftY, springY] as MotionValue[],
    ([d, r]: number[]) => (reduced ? 0 : -d * drift + r)
  );

  // Recompute repulsion whenever the cursor moves. px & py update together, so
  // subscribing to px alone (and reading py) covers every move. The icon's rest
  // centre is derived from the layer rect + its own %/size — no per-icon layout
  // reads on scroll.
  useMotionValueEvent(px, "change", (mx) => {
    if (reduced) return;
    const rect = rectRef.current;
    if (!rect) return;
    const my = py.get();
    const cx = rect.left + (doodle.left / 100) * rect.width + doodle.size / 2;
    const cy = rect.top + (doodle.top / 100) * rect.height + doodle.size / 2;
    const dx = cx - mx;
    const dy = cy - my;
    const dist = Math.hypot(dx, dy) || 1;
    if (dist < REPEL_RADIUS) {
      // Ease-in falloff, strongest right at the cursor; deeper icons shove more.
      const t = 1 - dist / REPEL_RADIUS;
      const push = t * t * REPEL_STRENGTH * (0.5 + doodle.depth * 0.5);
      repelX.set((dx / dist) * push);
      repelY.set((dy / dist) * push);
    } else {
      repelX.set(0);
      repelY.set(0);
    }
  });

  const colorClass =
    tone === "light" ? "text-blue-200/45" : "text-blue-600/40";

  return (
    <div
      className={cn(
        "absolute",
        doodle.hideOnMobile && "hidden md:block"
      )}
      style={{ top: `${doodle.top}%`, left: `${doodle.left}%` }}
    >
      <motion.div className="will-change-transform" style={{ x, y }}>
        <motion.div
          initial={false}
          animate={
            reduced
              ? undefined
              : { y: [0, -12, 0], rotate: [doodle.rotate, doodle.rotate + 6, doodle.rotate] }
          }
          transition={
            reduced
              ? undefined
              : { duration: doodle.duration, repeat: Infinity, ease: "easeInOut" }
          }
          style={{ rotate: doodle.rotate }}
        >
          <doodle.Icon
            className={colorClass}
            style={{ width: doodle.size, height: doodle.size }}
            strokeWidth={1.6}
          />
        </motion.div>
      </motion.div>
    </div>
  );
}

/**
 * A decorative, non-interactive layer of school/study line-art icons scattered
 * across empty background space. The whole layer drifts subtly with the cursor
 * (depth parallax) and each icon also gently idle-floats — and any icon the
 * cursor comes near is pushed out of the way, springing back once it passes
 * ("making space for the mouse").
 *
 * Drop it as the first child of a `relative overflow-hidden` section and keep the
 * real content above it (e.g. wrap content in `relative z-10`).
 */
export function FloatingDoodles({
  tone = "dark",
  count = 14,
  fixed = false,
  className,
}: FloatingDoodlesProps) {
  const reduced = useReducedMotion() ?? false;
  const { x: driftX, y: driftY } = useMouseMotion();
  const { px, py } = usePointer();
  const doodles = DOODLES.slice(0, Math.min(count, DOODLES.length));

  // The layer's viewport rect, measured once here (not per icon) and refreshed
  // on scroll/resize. Every doodle derives its rest centre from this + its %/size.
  const layerRef = useRef<HTMLDivElement>(null);
  const rectRef = useRef<DOMRect | null>(null);
  useEffect(() => {
    if (reduced) return;
    const measure = () => {
      const el = layerRef.current;
      if (el) rectRef.current = el.getBoundingClientRect();
    };
    measure();
    window.addEventListener("scroll", measure, { passive: true });
    window.addEventListener("resize", measure);
    return () => {
      window.removeEventListener("scroll", measure);
      window.removeEventListener("resize", measure);
    };
  }, [reduced]);

  return (
    <div
      ref={layerRef}
      aria-hidden="true"
      className={cn(
        "pointer-events-none overflow-hidden",
        fixed ? "fixed inset-0 -z-10" : "absolute inset-0 z-0",
        className
      )}
    >
      {doodles.map((doodle, i) => (
        <ParallaxDoodle
          key={i}
          doodle={doodle}
          tone={tone}
          reduced={reduced}
          driftX={driftX}
          driftY={driftY}
          px={px}
          py={py}
          rectRef={rectRef}
        />
      ))}
    </div>
  );
}
