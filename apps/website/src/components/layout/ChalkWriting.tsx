"use client";

import { useEffect, useRef } from "react";

/**
 * Click-and-drag chalk writing. Hold the left mouse button and drag to lay
 * down a grainy chalk stroke on the board; each bit of the stroke stays fully
 * visible for HOLD_MS, then fades over FADE_MS — like real chalk that someone
 * slowly wipes away.
 *
 * The canvas is pointer-events-none so the page stays fully usable: a plain
 * click writes nothing (needs drag movement), links/buttons keep working, and
 * text-entry fields are skipped so you can still type/select in them.
 * Desktop-only (fine pointer). Strokes are stored in document coordinates so
 * they scroll with the page.
 */
const HOLD_MS = 1500;
const FADE_MS = 1500;
const CHALK = "244,241,232";

interface Dab {
  x: number;
  y: number;
  r: number;
  a: number;
  born: number;
}

export function ChalkWriting() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    if (!window.matchMedia("(hover: hover) and (pointer: fine)").matches) return;

    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

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

    const dabs: Dab[] = [];
    const MAX_DABS = 22000; // safety cap for very long scribbles
    let drawing = false;
    let last: { x: number; y: number } | null = null;
    let running = false;

    const spray = (x: number, y: number) => {
      const now = performance.now();
      // soft body of the stroke
      for (let i = 0; i < 4; i++) {
        const ang = Math.random() * Math.PI * 2;
        const rad = Math.random() * 5.5;
        dabs.push({
          x: x + Math.cos(ang) * rad,
          y: y + Math.sin(ang) * rad,
          r: 0.5 + Math.random() * 1.5,
          a: 0.22 + Math.random() * 0.34,
          born: now,
        });
      }
      // brighter core speck
      dabs.push({ x, y, r: 0.9 + Math.random(), a: 0.5 + Math.random() * 0.3, born: now });
      if (dabs.length > MAX_DABS) dabs.splice(0, dabs.length - MAX_DABS);
    };

    const addPoint = (x: number, y: number) => {
      if (last) {
        const dx = x - last.x;
        const dy = y - last.y;
        const dist = Math.hypot(dx, dy);
        const steps = Math.max(1, Math.floor(dist / 2));
        for (let i = 1; i <= steps; i++) {
          spray(last.x + (dx * i) / steps, last.y + (dy * i) / steps);
        }
      } else {
        spray(x, y);
      }
      last = { x, y };
    };

    const loop = () => {
      const t = performance.now();
      // Dabs are stored in document space; offset by the current scroll so the
      // chalk stays anchored to the page, not the screen.
      const sx = window.scrollX;
      const sy = window.scrollY;
      ctx.clearRect(0, 0, w, h);
      for (let i = dabs.length - 1; i >= 0; i--) {
        const d = dabs[i];
        const age = t - d.born;
        if (age >= HOLD_MS + FADE_MS) {
          dabs.splice(i, 1);
          continue;
        }
        const life = age < HOLD_MS ? 1 : 1 - (age - HOLD_MS) / FADE_MS;
        ctx.globalAlpha = d.a * life;
        ctx.fillStyle = `rgba(${CHALK},1)`;
        ctx.beginPath();
        ctx.arc(d.x - sx, d.y - sy, d.r, 0, 6.283);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      if (dabs.length || drawing) {
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

    const onDown = (e: MouseEvent) => {
      if (e.button !== 0 || isText(e.target)) return;
      drawing = true;
      last = null;
      addPoint(e.clientX + window.scrollX, e.clientY + window.scrollY);
      kick();
    };
    const onMove = (e: MouseEvent) => {
      if (!drawing) return;
      addPoint(e.clientX + window.scrollX, e.clientY + window.scrollY);
      kick();
    };
    const onUp = () => {
      drawing = false;
      last = null;
    };

    window.addEventListener("mousedown", onDown);
    window.addEventListener("mousemove", onMove, { passive: true });
    window.addEventListener("mouseup", onUp);
    window.addEventListener("blur", onUp);

    return () => {
      window.removeEventListener("resize", size);
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      window.removeEventListener("blur", onUp);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden
      className="pointer-events-none fixed inset-0 z-[55]"
    />
  );
}
