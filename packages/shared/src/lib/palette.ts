/**
 * The categorical palette: colours that mean "different from each other" and
 * nothing more.
 *
 * Before this, eight files each rolled their own rotation and none of them
 * agreed. Staff avatars went navy → blue → gold → emerald → violet → rose →
 * cyan → amber; the portal timetables went blue → green → purple → amber →
 * pink → teal → indigo → orange; the exam hub went blue → emerald → amber →
 * violet → rose → cyan → fuchsia → orange → teal → pink → indigo. Between
 * them they pulled in fifteen Tailwind colour families that the app has no
 * other use for, and the same subject came out a different colour on every
 * screen that drew it.
 *
 * `--cat-1..8` (globals.css) is one ramp for all of it: eight hues at one
 * lightness and one chroma, defined per theme so dark mode is handled by the
 * token rather than by a `dark:` class on every usage.
 *
 * NOT for status. Success, warning and danger are meanings, not categories —
 * they stay green / amber / red, and the point of keeping the two apart is
 * that a red category would read as a problem when it is just the fifth item
 * in a list.
 */

/** How many distinct hues before the ramp repeats. */
export const CATEGORICAL_COUNT = 8;

/**
 * A stable index into the ramp for a key — the same subject, teacher or exam
 * type gets the same colour everywhere, every session, without storing one.
 *
 * FNV-1a rather than summing char codes: a sum gives anagrams the same colour
 * and clusters short strings into the low indices, which is how a timetable
 * ends up with three adjacent periods in the same blue.
 */
export function categoricalIndex(key: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h % CATEGORICAL_COUNT;
}

/** Tailwind classes for a filled chip — a subject block, a legend swatch. */
export function categoricalChip(key: string | number): string {
  const n = (typeof key === "number" ? key % CATEGORICAL_COUNT : categoricalIndex(key)) + 1;
  // One string, no `dark:` half: the token already carries both themes, so
  // the tint and the text track it automatically.
  return CHIP[n - 1];
}

/** Tailwind classes for a solid swatch — a bar segment, a dot. */
export function categoricalSolid(key: string | number): string {
  const n = (typeof key === "number" ? key % CATEGORICAL_COUNT : categoricalIndex(key)) + 1;
  return SOLID[n - 1];
}

/** Tailwind classes for an avatar disc: solid fill, light text over it. */
export function categoricalAvatar(key: string | number): string {
  const n = (typeof key === "number" ? key % CATEGORICAL_COUNT : categoricalIndex(key)) + 1;
  return AVATAR[n - 1];
}

// Written out rather than built with template strings: Tailwind scans source
// for complete class names, and `bg-cat-${n}/10` is invisible to it.
const CHIP = [
  "bg-cat-1/10 border-cat-1/35 text-cat-1",
  "bg-cat-2/10 border-cat-2/35 text-cat-2",
  "bg-cat-3/10 border-cat-3/35 text-cat-3",
  "bg-cat-4/10 border-cat-4/35 text-cat-4",
  "bg-cat-5/10 border-cat-5/35 text-cat-5",
  "bg-cat-6/10 border-cat-6/35 text-cat-6",
  "bg-cat-7/10 border-cat-7/35 text-cat-7",
  "bg-cat-8/10 border-cat-8/35 text-cat-8",
] as const;

const SOLID = [
  "bg-cat-1",
  "bg-cat-2",
  "bg-cat-3",
  "bg-cat-4",
  "bg-cat-5",
  "bg-cat-6",
  "bg-cat-7",
  "bg-cat-8",
] as const;

const AVATAR = [
  "bg-cat-1 text-white",
  "bg-cat-2 text-white",
  "bg-cat-3 text-white",
  "bg-cat-4 text-white",
  "bg-cat-5 text-white",
  "bg-cat-6 text-white",
  "bg-cat-7 text-white",
  "bg-cat-8 text-white",
] as const;
