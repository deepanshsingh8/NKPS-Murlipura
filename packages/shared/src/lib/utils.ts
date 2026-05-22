import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Format class display name with section and optional stream.
 * e.g. "XII - A (Science)", "V - B"
 * Handles stream_name as string, or streams join as object or array from Supabase.
 */
export function formatClassName(cls: {
  name: string;
  section: string;
  stream_name?: string | null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  streams?: any;
}): string {
  let stream: string | null = null;
  if (cls.stream_name) {
    stream = cls.stream_name;
  } else if (cls.streams) {
    // Supabase FK join may return object or array depending on query
    if (Array.isArray(cls.streams)) {
      stream = cls.streams[0]?.name ?? null;
    } else {
      stream = cls.streams.name ?? null;
    }
  }
  if (stream) {
    return `${cls.name} - ${cls.section} (${stream})`;
  }
  return `${cls.name} - ${cls.section}`;
}

/**
 * Convert a JS Date to the schema's day_of_week (1=Monday..6=Saturday).
 * Returns 7 for Sunday — the schema has no Sunday rows, so callers can treat
 * that as "no school today".
 */
export function dayOfWeekFromDate(date: Date = new Date()): number {
  const js = date.getDay(); // 0=Sun..6=Sat
  return js === 0 ? 7 : js;
}

/**
 * Short date like "22 Apr" used in compact info bars.
 */
export function formatShortDate(input: string | Date): string {
  const d = typeof input === "string" ? new Date(input) : input;
  if (isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short" });
}

/**
 * "HH:MM" (24h) → minutes since midnight. Returns -1 for bad input.
 */
export function timeStringToMinutes(time: string | null | undefined): number {
  if (!time) return -1;
  const parts = time.split(":");
  if (parts.length < 2) return -1;
  const h = parseInt(parts[0], 10);
  const m = parseInt(parts[1], 10);
  if (isNaN(h) || isNaN(m)) return -1;
  return h * 60 + m;
}

/**
 * Current minutes since midnight — kept as a helper so callers don't
 * sprinkle Date arithmetic everywhere.
 */
export function nowMinutes(date: Date = new Date()): number {
  return date.getHours() * 60 + date.getMinutes();
}

/**
 * Build a safe Content-Disposition header value. Strips CRLF (prevents header
 * injection), limits the ASCII form to word/hyphen/dot, and adds a UTF-8
 * filename* form so non-ASCII names still land correctly in modern browsers.
 */
export function contentDispositionAttachment(rawName: string): string {
  const cleaned = rawName.replace(/[\r\n]/g, "");
  const ascii = cleaned.replace(/[^\w\-.]+/g, "_") || "download";
  const utf8 = encodeURIComponent(cleaned);
  return `attachment; filename="${ascii}"; filename*=UTF-8''${utf8}`;
}

/**
 * Convert "HH:MM" / "HH:MM:SS" to a 12-hour "h:MM am/pm" display.
 */
export function formatTime12(time: string | null | undefined): string {
  if (!time) return "";
  const parts = time.split(":");
  if (parts.length < 2) return time;
  let h = parseInt(parts[0], 10);
  const m = parts[1];
  if (isNaN(h)) return time;
  const suffix = h >= 12 ? "pm" : "am";
  h = h % 12;
  if (h === 0) h = 12;
  return `${h}:${m} ${suffix}`;
}
