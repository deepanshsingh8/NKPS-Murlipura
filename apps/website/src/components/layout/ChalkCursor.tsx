"use client";

import { useEffect, useRef } from "react";

/**
 * Site-wide chalk cursor for the blackboard theme.
 *
 * A chalk-stick tip follows the pointer and leaves a fading dust trail on a
 * full-viewport canvas. Deliberately an *enhancement*, not a navigation
 * mechanism, so it self-disables where it would hurt usability:
 *   - touch / coarse pointers            → off entirely (native experience)
 *   - prefers-reduced-motion             → tip stays, dust trail disabled
 *   - over inputs / textareas / selects  → hands the native caret back
 * Links and buttons still work; the tip just scales up over them.
 */
export function ChalkCursor() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const tipRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const fine = window.matchMedia("(hover: hover) and (pointer: fine)").matches;
    if (!fine) return; // touch devices keep the native experience

    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const canvas = canvasRef.current;
    const tip = tipRef.current;
    const glyph = tip?.firstElementChild as SVGElement | null;
    if (!canvas || !tip) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const root = document.documentElement;
    root.classList.add("chalk-cursor-active");

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    let w = 0;
    let h = 0;
    const size = () => {
      w = window.innerWidth;
      h = window.innerHeight;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    size();
    window.addEventListener("resize", size);

    type P = { x: number; y: number; vx: number; vy: number; life: number; decay: number; r: number };
    const particles: P[] = [];
    let lastX: number | null = null;
    let lastY: number | null = null;
    let running = false;

    const emit = (x: number, y: number) => {
      if (reduce) return;
      const dx = lastX == null ? 0 : x - lastX;
      const dy = lastY == null ? 0 : y - lastY;
      const speed = Math.min(Math.hypot(dx, dy), 40);
      const count = 1 + Math.round(speed / 7);
      for (let i = 0; i < count; i++) {
        particles.push({
          x: x + (Math.random() - 0.5) * 7,
          y: y + (Math.random() - 0.5) * 7,
          vx: (Math.random() - 0.5) * 0.7 - dx * 0.03,
          vy: (Math.random() - 0.5) * 0.7 - dy * 0.03 + 0.15,
          life: 1,
          decay: 0.012 + Math.random() * 0.02,
          r: 0.6 + Math.random() * 1.5,
        });
      }
      lastX = x;
      lastY = y;
    };

    const loop = () => {
      ctx.clearRect(0, 0, w, h);
      for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        p.x += p.vx;
        p.y += p.vy;
        p.vy += 0.02;
        p.life -= p.decay;
        if (p.life <= 0) {
          particles.splice(i, 1);
          continue;
        }
        ctx.globalAlpha = p.life * 0.5;
        ctx.fillStyle = "rgba(242,239,228,1)";
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, 6.283);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      if (particles.length) {
        requestAnimationFrame(loop);
      } else {
        running = false;
      }
    };
    const kick = () => {
      if (!running) {
        running = true;
        requestAnimationFrame(loop);
      }
    };

    const isText = (el: EventTarget | null) =>
      el instanceof Element && el.closest("input,textarea,select,[contenteditable]");

    const onMove = (e: MouseEvent) => {
      if (isText(e.target)) {
        tip.style.opacity = "0";
        root.classList.add("chalk-cursor-text");
        return;
      }
      root.classList.remove("chalk-cursor-text");
      tip.style.transform = `translate(${e.clientX}px,${e.clientY}px) translate(-50%,-50%) rotate(38deg)`;
      tip.style.opacity = "1";
      const over = e.target instanceof Element && e.target.closest("a,button,[role='button']");
      if (glyph) glyph.style.transform = over ? "scale(1.18)" : "scale(1)";
      emit(e.clientX, e.clientY);
      kick();
    };
    const onLeave = () => {
      tip.style.opacity = "0";
      lastX = null;
      lastY = null;
    };

    window.addEventListener("mousemove", onMove, { passive: true });
    document.addEventListener("mouseleave", onLeave);

    return () => {
      window.removeEventListener("resize", size);
      window.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseleave", onLeave);
      root.classList.remove("chalk-cursor-active", "chalk-cursor-text");
    };
  }, []);

  return (
    <>
      <canvas
        ref={canvasRef}
        aria-hidden
        className="pointer-events-none fixed inset-0 z-[60]"
      />
      <div
        ref={tipRef}
        aria-hidden
        className="pointer-events-none fixed left-0 top-0 z-[9999] h-[26px] w-[26px] opacity-0 transition-opacity duration-150 will-change-transform"
      >
        <svg
          width="26"
          height="26"
          viewBox="0 0 26 26"
          style={{ transformOrigin: "center", transition: "transform 0.15s" }}
        >
          <rect x="10" y="2" width="6" height="18" rx="2.5" fill="#f2efe4" stroke="#c9c6ba" strokeWidth="1" />
          <rect x="10" y="2" width="6" height="4" rx="2.5" fill="#e79aa4" />
          <ellipse cx="13" cy="21" rx="3.2" ry="2" fill="#e8c25f" opacity="0.55" />
        </svg>
      </div>
    </>
  );
}
