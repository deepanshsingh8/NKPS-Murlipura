// Lightweight in-memory rate limiter for public endpoints.
//
// Trade-offs:
//  - Per-process state. On a multi-instance deploy each instance gets its own
//    counter, so a determined attacker can multiply the limit by N. That's
//    acceptable for our scale (single-region school deployment) and is far
//    better than the current state of "no limit at all". Move to Redis/Upstash
//    if/when the deployment grows.
//  - Memory grows with unique keys but is bounded: keys are evicted lazily on
//    access and proactively when a sweep finds the cache over MAX_ENTRIES.

import type { NextRequest } from "next/server";

type Bucket = { hits: number; resetAt: number };

const MAX_ENTRIES = 10_000;
const buckets = new Map<string, Bucket>();
let lastSweepAt = 0;

function sweepIfNeeded(now: number) {
  // Sweep at most once a minute; cheap.
  if (now - lastSweepAt < 60_000 && buckets.size < MAX_ENTRIES) return;
  lastSweepAt = now;
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
  // Hard cap: if still over, drop the oldest entries (Map iterates in
  // insertion order so the head is the oldest).
  if (buckets.size > MAX_ENTRIES) {
    const overflow = buckets.size - MAX_ENTRIES;
    let i = 0;
    for (const key of buckets.keys()) {
      if (i++ >= overflow) break;
      buckets.delete(key);
    }
  }
}

export interface RateLimitResult {
  ok: boolean;
  remaining: number;
  resetSeconds: number;
}

export interface RateLimitOptions {
  /** Logical name of the limit, e.g. "forgot-password". */
  name: string;
  /** Stable identifier for the caller (IP, email, parent_id, etc.). */
  key: string;
  /** Max hits in the window. */
  max: number;
  /** Window length in seconds. */
  windowSeconds: number;
}

export function rateLimit({
  name,
  key,
  max,
  windowSeconds,
}: RateLimitOptions): RateLimitResult {
  const now = Date.now();
  sweepIfNeeded(now);

  const bucketKey = `${name}:${key}`;
  const existing = buckets.get(bucketKey);

  if (!existing || existing.resetAt <= now) {
    const resetAt = now + windowSeconds * 1000;
    buckets.set(bucketKey, { hits: 1, resetAt });
    return { ok: true, remaining: max - 1, resetSeconds: windowSeconds };
  }

  existing.hits += 1;
  const resetSeconds = Math.max(0, Math.ceil((existing.resetAt - now) / 1000));
  if (existing.hits > max) {
    return { ok: false, remaining: 0, resetSeconds };
  }
  return { ok: true, remaining: Math.max(0, max - existing.hits), resetSeconds };
}

/**
 * Best-effort client IP from common reverse-proxy headers, falling back to
 * a constant string so callers never have to handle nullable. Vercel sets
 * `x-forwarded-for`; behind some hosts `x-real-ip` is the only one available.
 */
export function clientIp(request: Request | NextRequest): string {
  const xff = request.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0]!.trim();
  const real = request.headers.get("x-real-ip");
  if (real) return real.trim();
  return "unknown";
}
