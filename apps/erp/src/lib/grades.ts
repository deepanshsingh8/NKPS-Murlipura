/**
 * Grade badge colours, in one place.
 *
 * This map used to exist six times, byte-identical, in student/results,
 * parent/results, teacher/results, teacher/class-tests, exams/results and
 * exams/class-tests — so a change to how a grade looks meant six edits, and
 * any one of them drifting was invisible until someone compared two screens.
 *
 * It is an ORDINAL scale, which is what the old colours got wrong. They ran
 * green, green, blue, blue, yellow, orange, red: not monotonic (blue sits
 * outside a green-to-red ramp, so B looked unrelated to A and C rather than
 * between them), and A+ was separated from A, and B+ from B, only by a -100
 * vs -50 background step — a difference you cannot actually see.
 *
 * `--grade-1..7` (globals.css) rotates hue evenly from green to red at one
 * lightness, so the seven steps are seven steps, and severity reads off a
 * badge without a legend.
 *
 * It lives in apps/erp rather than packages/shared because only the ERP shows
 * grades — and because the tokens are declared in the ERP's globals.css, a
 * shared module would have the CMS generating `bg-grade-*` classes against
 * variables that are not defined there.
 */

/** A+ is best. Anything outside this set falls back to neutral. */
type Grade = "A+" | "A" | "B+" | "B" | "C" | "D" | "F";

// Spelled out rather than built with `bg-grade-${n}` — Tailwind scans source
// for complete class names and would not see an interpolated one.
const GRADE_CHIP: Record<Grade, string> = {
  "A+": "bg-grade-1/12 text-grade-1 border-grade-1/35",
  A: "bg-grade-2/12 text-grade-2 border-grade-2/35",
  "B+": "bg-grade-3/12 text-grade-3 border-grade-3/35",
  B: "bg-grade-4/12 text-grade-4 border-grade-4/35",
  C: "bg-grade-5/12 text-grade-5 border-grade-5/35",
  D: "bg-grade-6/12 text-grade-6 border-grade-6/35",
  F: "bg-grade-7/12 text-grade-7 border-grade-7/35",
};

const NEUTRAL =
  "bg-gray-100 text-gray-700 border-gray-200 dark:bg-muted dark:text-gray-300 dark:border-border";

/**
 * Tailwind classes for one grade badge. An unknown or absent grade gets the
 * neutral chip rather than no classes at all, which is what the six local
 * copies did (`GRADE_COLORS[g] ?? ""`) and which rendered an unstyled badge.
 */
export function gradeChip(grade: string | null | undefined): string {
  if (!grade) return NEUTRAL;
  return GRADE_CHIP[grade as Grade] ?? NEUTRAL;
}
