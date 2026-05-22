// Class-name normalization for old-ERP-software exports.
//
// The previous software stored class names in word form: "FIRST", "SIXTH",
// "TWELFTH (COMM.)", "PLAY GROUP". Our ERP uses Roman numerals + a separate
// `stream_id` FK. This module converts source strings into the canonical
// `{ class_name, stream_name? }` pair the ERP expects.

export type StreamName = "Science" | "Commerce" | "Arts" | null;

export interface NormalizedClass {
  class_name: string;
  stream_name: StreamName;
}

// Word → Roman map. Keys are normalized (uppercased, single-spaced, no dots).
const WORD_TO_ROMAN: Record<string, string> = {
  FIRST: "I",
  SECOND: "II",
  THIRD: "III",
  FOURTH: "IV",
  FIFTH: "V",
  SIXTH: "VI",
  SEVENTH: "VII",
  EIGHTH: "VIII",
  NINTH: "IX",
  TENTH: "X",
  ELEVENTH: "XI",
  TWELFTH: "XII",
  // Pre-primary names map to themselves (ERP uses the same labels).
  NURSERY: "Nursery",
  "PLAY GROUP": "Nursery", // Old software's "PLAY GROUP" = our "Nursery"
  PLAYGROUP: "Nursery",
  LKG: "LKG",
  UKG: "UKG",
};

// Stream markers seen in the source data. Match a parenthesized suffix.
const STREAM_PATTERNS: Array<{ pattern: RegExp; stream: StreamName }> = [
  { pattern: /\(\s*SCI\.?\s*\)/i, stream: "Science" },
  { pattern: /\(\s*COMM\.?\s*\)/i, stream: "Commerce" },
  { pattern: /\(\s*ARTS?\.?\s*\)/i, stream: "Arts" },
  { pattern: /\(\s*HUM(?:ANITIES)?\.?\s*\)/i, stream: "Arts" },
];

/**
 * Normalize a class name from the old software's exports.
 *
 * Returns `null` if the name is not recognized — the caller must surface this
 * to the user as an "unmapped class" so they can supply a mapping in the UI.
 *
 * Examples:
 *   "SIXTH"               → { class_name: "VI",      stream_name: null }
 *   "TWELFTH (COMM.)"     → { class_name: "XII",     stream_name: "Commerce" }
 *   "ELEVENTH(SCI.)"      → { class_name: "XI",      stream_name: "Science" }
 *   "PLAY GROUP"          → { class_name: "Nursery", stream_name: null }
 *   "LKG"                 → { class_name: "LKG",     stream_name: null }
 *   "I" (already Roman)   → { class_name: "I",       stream_name: null }
 */
export function normalizeClassName(raw: string): NormalizedClass | null {
  if (!raw || typeof raw !== "string") return null;

  // Detect stream first, then strip the parenthesized suffix.
  let stream: StreamName = null;
  let stripped = raw;
  for (const { pattern, stream: s } of STREAM_PATTERNS) {
    if (pattern.test(stripped)) {
      stream = s;
      stripped = stripped.replace(pattern, "");
      break;
    }
  }

  // Normalize: uppercase, collapse whitespace, drop trailing dots.
  const key = stripped
    .toUpperCase()
    .replace(/\./g, "")
    .replace(/\s+/g, " ")
    .trim();

  // Direct hit on the word map.
  const mapped = WORD_TO_ROMAN[key];
  if (mapped) {
    return { class_name: mapped, stream_name: stream };
  }

  // Already-Roman pass-through (I…XII).
  if (/^(?:I|II|III|IV|V|VI|VII|VIII|IX|X|XI|XII)$/.test(key)) {
    return { class_name: key, stream_name: stream };
  }

  // Plain number → Roman (1..12).
  if (/^\d+$/.test(key)) {
    const n = parseInt(key, 10);
    const ROMANS = [
      "",
      "I",
      "II",
      "III",
      "IV",
      "V",
      "VI",
      "VII",
      "VIII",
      "IX",
      "X",
      "XI",
      "XII",
    ];
    if (n >= 1 && n <= 12) {
      return { class_name: ROMANS[n], stream_name: stream };
    }
  }

  return null;
}

/**
 * Apply user-supplied overrides on top of the built-in map.
 * `overrides` keys are the raw source strings; values are the ERP class name
 * (and optional stream) the user picked in the dialog.
 */
export function normalizeClassNameWithOverrides(
  raw: string,
  overrides: Record<string, NormalizedClass> = {}
): NormalizedClass | null {
  if (overrides[raw]) return overrides[raw];
  // Also try a normalized key (in case the override was registered without
  // exact whitespace match).
  const normalizedKey = raw.toUpperCase().replace(/\s+/g, " ").trim();
  if (overrides[normalizedKey]) return overrides[normalizedKey];
  return normalizeClassName(raw);
}
