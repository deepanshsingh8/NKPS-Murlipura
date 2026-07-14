"use client";

import {
  motion,
  useReducedMotion,
  useTransform,
  type MotionValue,
} from "framer-motion";
import { useMouseMotion } from "@nkps/shared/hooks/useMousePosition";
import { cn } from "@nkps/shared/lib/utils";

/**
 * Ambient layer of hand-drawn chalk "school objects" (flask, atom, book,
 * grad cap, protractor, paper plane…) scattered into the empty margins of the
 * board. Each drifts at its own depth on mouse-move and idle-floats, so the
 * blank chalkboard feels alive. Purely decorative: aria-hidden,
 * pointer-events-none, desktop-only, and static under prefers-reduced-motion.
 */

type IconKey =
  | "flask" | "atom" | "book" | "cap" | "pencil" | "setsquare"
  | "protractor" | "ruler" | "star" | "plane" | "planet" | "bulb"
  | "compass" | "clock" | "globe" | "note" | "pi" | "abc";

// viewBox is 0 0 64 64 for every icon. Strokes only; the chalk roughness comes
// from the shared displacement filter applied on the <svg>.
const ICONS: Record<IconKey, React.ReactNode> = {
  flask: (
    <>
      <path d="M26 8h12M28 8v16L15 50a5 5 0 0 0 4 8h26a5 5 0 0 0 4-8L36 24V8" />
      <path d="M22 42h20" />
      <circle cx="28" cy="48" r="1.6" /><circle cx="35" cy="52" r="1.4" /><circle cx="32" cy="45" r="1.2" />
    </>
  ),
  atom: (
    <>
      <circle cx="32" cy="32" r="3.2" />
      <ellipse cx="32" cy="32" rx="26" ry="10" />
      <ellipse cx="32" cy="32" rx="26" ry="10" transform="rotate(60 32 32)" />
      <ellipse cx="32" cy="32" rx="26" ry="10" transform="rotate(120 32 32)" />
    </>
  ),
  book: (
    <>
      <path d="M32 16c-6-4-14-5-22-4v34c8-1 16 0 22 4 6-4 14-5 22-4V12c-8-1-16 0-22 4z" />
      <path d="M32 16v38" />
      <path d="M12 22c5-.6 10-.3 15 1.5M12 30c5-.6 10-.3 15 1.5M37 23.5c5-1.8 10-2.1 15-1.5M37 31.5c5-1.8 10-2.1 15-1.5" />
    </>
  ),
  cap: (
    <>
      <path d="M4 26 32 14l28 12-28 12z" />
      <path d="M18 33v11c0 3 28 3 28 0V33" />
      <path d="M60 26v12M60 38a2 2 0 1 0 0 .1" />
    </>
  ),
  pencil: (
    <>
      <path d="M12 52l6-2 30-30-4-4-30 30z" />
      <path d="M40 20l4 4M12 52l4-1.2" />
      <path d="M44 16l4-4a3 3 0 0 1 4 0l0 0a3 3 0 0 1 0 4l-4 4z" />
    </>
  ),
  setsquare: (
    <>
      <path d="M10 14v40h44z" />
      <path d="M18 46h26M18 40v6" />
      <path d="M16 22v6M16 30v4" />
    </>
  ),
  protractor: (
    <>
      <path d="M8 44a24 24 0 0 1 48 0z" />
      <path d="M8 44h48" />
      <path d="M20 44a12 12 0 0 1 24 0" />
      <path d="M32 20v6M20 26l3 5M44 26l-3 5" />
    </>
  ),
  ruler: (
    <>
      <rect x="8" y="24" width="48" height="16" rx="1.5" transform="rotate(-18 32 32)" />
      <path d="M18 26v5M26 23v7M34 21v5M42 18v7M50 16v5" transform="rotate(-18 32 32)" />
    </>
  ),
  star: <path d="M32 8l7 15 16 2-12 11 3 16-14-8-14 8 3-16L9 25l16-2z" />,
  plane: (
    <>
      <path d="M8 30 56 10 40 56 30 40z" />
      <path d="M30 40 56 10M30 40l-6 12" />
    </>
  ),
  planet: (
    <>
      <circle cx="30" cy="30" r="16" />
      <ellipse cx="30" cy="32" rx="30" ry="9" transform="rotate(-24 30 32)" />
    </>
  ),
  bulb: (
    <>
      <path d="M32 8a16 16 0 0 0-9 29c2 1.4 3 3 3 5v3h12v-3c0-2 1-3.6 3-5A16 16 0 0 0 32 8z" />
      <path d="M26 52h12M28 57h8" />
      <path d="M32 4v-3M52 20h3M9 20H6M48 8l2-2M16 8l-2-2" />
    </>
  ),
  compass: (
    <>
      <circle cx="32" cy="12" r="3" />
      <path d="M31 15 16 54M33 15l15 39" />
      <path d="M24 40l8 6 8-6" />
    </>
  ),
  clock: (
    <>
      <circle cx="32" cy="36" r="20" />
      <path d="M32 24v12l8 5" />
      <path d="M18 16l8 6M46 16l-8 6" />
    </>
  ),
  globe: (
    <>
      <circle cx="32" cy="32" r="22" />
      <ellipse cx="32" cy="32" rx="9" ry="22" />
      <path d="M10 32h44M14 20h36M14 44h36" />
    </>
  ),
  note: (
    <>
      <path d="M26 46V16l22-5v30" />
      <ellipse cx="20" cy="46" rx="6" ry="4.5" transform="rotate(-18 20 46)" />
      <ellipse cx="42" cy="41" rx="6" ry="4.5" transform="rotate(-18 42 41)" />
    </>
  ),
  pi: <path d="M14 22h36M22 22v24M42 22v20c0 3 4 3 6 1M28 46c-2 0-2-2-2-4" />,
  abc: (
    <>
      <path d="M8 44 14 22l6 22M9.5 38h9" />
      <path d="M26 22h7a5 5 0 0 1 0 10h-7zM26 32h8a5 5 0 0 1 0 10h-8z" />
      <path d="M56 26a8 8 0 0 0-11 6 8 8 0 0 0 11 6" />
    </>
  ),
};

interface DoodleSpec {
  icon: IconKey;
  /** position in % of the layer; use left OR right, top OR bottom */
  left?: number; right?: number; top?: number; bottom?: number;
  size: number;      // px
  depth: number;     // parallax travel in px
  rotate: number;    // base tilt
  opacity: number;
  duration: number;  // idle-float seconds
}

// Curated scatter that lives mostly in the page's side gutters and quiet
// bands so it fills emptiness without crowding centred content.
const DEFAULT_SCATTER: DoodleSpec[] = [
  { icon: "flask",      left: 3,  top: 16,  size: 62, depth: 22, rotate: -8, opacity: 0.5,  duration: 7 },
  { icon: "atom",       right: 4, top: 10,  size: 74, depth: 30, rotate: 6,  opacity: 0.42, duration: 9 },
  { icon: "cap",        right: 8, top: 30,  size: 58, depth: 16, rotate: -5, opacity: 0.5,  duration: 8 },
  { icon: "book",       left: 6,  top: 46,  size: 66, depth: 26, rotate: 7,  opacity: 0.4,  duration: 8.5 },
  { icon: "protractor", right: 5, top: 52,  size: 60, depth: 20, rotate: -4, opacity: 0.44, duration: 7.5 },
  { icon: "plane",      right: 3, bottom: 20, size: 64, depth: 34, rotate: 10, opacity: 0.5, duration: 10 },
  { icon: "star",       left: 10, top: 30,  size: 30, depth: 40, rotate: 0,  opacity: 0.55, duration: 6 },
  { icon: "pencil",     left: 4,  bottom: 24, size: 58, depth: 18, rotate: -12, opacity: 0.42, duration: 8 },
  { icon: "setsquare",  left: 8,  bottom: 8, size: 54, depth: 24, rotate: 4,  opacity: 0.4,  duration: 9 },
  { icon: "planet",     right: 9, bottom: 8, size: 68, depth: 28, rotate: -6, opacity: 0.4,  duration: 9.5 },
  { icon: "bulb",       left: 13, top: 62,  size: 40, depth: 36, rotate: 3,  opacity: 0.45, duration: 6.5 },
  { icon: "pi",         right: 13, top: 40, size: 34, depth: 42, rotate: -3, opacity: 0.5,  duration: 6 },
  { icon: "clock",      left: 2,  top: 78,  size: 52, depth: 20, rotate: 8,  opacity: 0.38, duration: 8 },
  { icon: "note",       right: 2, top: 74,  size: 44, depth: 30, rotate: -8, opacity: 0.42, duration: 7 },
];

function Doodle({
  spec,
  mouseX,
  mouseY,
  still,
}: {
  spec: DoodleSpec;
  mouseX: MotionValue<number>;
  mouseY: MotionValue<number>;
  still: boolean;
}) {
  const x = useTransform(mouseX, (v) => (still ? 0 : v * spec.depth));
  const y = useTransform(mouseY, (v) => (still ? 0 : v * spec.depth));

  const pos: React.CSSProperties = {
    position: "absolute",
    left: spec.left != null ? `${spec.left}%` : undefined,
    right: spec.right != null ? `${spec.right}%` : undefined,
    top: spec.top != null ? `${spec.top}%` : undefined,
    bottom: spec.bottom != null ? `${spec.bottom}%` : undefined,
    width: spec.size,
    height: spec.size,
    opacity: spec.opacity,
  };

  return (
    <motion.div style={{ ...pos, x, y }}>
      <motion.div
        animate={still ? undefined : { y: [0, -7, 0], rotate: [spec.rotate - 1.5, spec.rotate + 1.5, spec.rotate - 1.5] }}
        transition={still ? undefined : { duration: spec.duration, repeat: Infinity, ease: "easeInOut" }}
        style={{ rotate: spec.rotate }}
      >
        <svg
          viewBox="0 0 64 64"
          width={spec.size}
          height={spec.size}
          fill="none"
          stroke="#f2efe4"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          filter="url(#chalk-rough)"
        >
          {ICONS[spec.icon]}
        </svg>
      </motion.div>
    </motion.div>
  );
}

export function ChalkObjects({ className }: { className?: string }) {
  const { x: mouseX, y: mouseY } = useMouseMotion(40, 18);
  const reduce = useReducedMotion() ?? false;

  return (
    <div
      aria-hidden
      className={cn(
        "pointer-events-none fixed inset-0 z-0 hidden overflow-hidden sm:block",
        className
      )}
    >
      {/* Shared chalk-roughness filter — displaces strokes so lines look
          hand-drawn and dusty rather than vector-crisp. */}
      <svg width="0" height="0" className="absolute">
        <defs>
          <filter id="chalk-rough" x="-20%" y="-20%" width="140%" height="140%">
            <feTurbulence type="fractalNoise" baseFrequency="0.09" numOctaves="2" seed="7" result="n" />
            <feDisplacementMap in="SourceGraphic" in2="n" scale="3.2" />
          </filter>
        </defs>
      </svg>
      {DEFAULT_SCATTER.map((spec, i) => (
        <Doodle key={i} spec={spec} mouseX={mouseX} mouseY={mouseY} still={reduce} />
      ))}
    </div>
  );
}
