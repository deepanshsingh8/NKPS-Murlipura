import { createLucideIcon } from "lucide-react";

/**
 * The mark for the school's assistant: a face with a tassel.
 *
 * It replaces lucide's `Sparkles`, which is the default "this was written by
 * a machine" badge across the entire industry and says nothing about a
 * school. `Bot` — the other obvious choice, and what the website agent's
 * header used — is the same problem one step down.
 *
 * WHY THERE IS NO MORTARBOARD. The first draft was a face under one, which
 * turned out to be lucide's `GraduationCap` (board rhombus, `M22 10v6`
 * tassel cord, U-shaped band) with two dots added. That icon already means
 * *Classes* and *Grade Master* in the ERP sidebar, plus Streams, Academics,
 * Exams and a student's qualifications — twenty-six usages across the apps.
 * At 20px, in the same menu, the assistant's row would have worn the icon
 * for Classes. So the board is gone and only the tassel is kept: enough to
 * say "school" without borrowing a glyph that is already spoken for.
 *
 * Built through createLucideIcon so it IS a LucideIcon — it takes `size`,
 * `strokeWidth` and `className` like every other icon, and drops into the
 * sidebar's `icon:` slots without widening their type.
 *
 * The eyes are filled circles rather than zero-length strokes: at 16px a
 * round-capped dot of stroke renders soft and reads as a smudge.
 */
export const AgentMark = createLucideIcon("AgentMark", [
  // The head. Squared-off at the top, wide round chin — a character, not the
  // head-and-shoulders silhouette that means "a user" elsewhere in the app.
  [
    "path",
    {
      d: "M6.5 4h11A2 2 0 0 1 19.5 6v5.5a6.5 6.5 0 0 1-6.5 6.5h-2A6.5 6.5 0 0 1 4.5 11.5V6a2 2 0 0 1 2-2z",
      key: "head",
    },
  ],
  // The tassel: draped over the top-right and hanging free.
  [
    "path",
    { d: "M17.8 4.1h1.9a1.1 1.1 0 0 1 1.1 1.1v4.3", key: "cord" },
  ],
  ["circle", { cx: "20.8", cy: "10.9", r: "1.05", fill: "currentColor", stroke: "none", key: "knot" }],
  ["circle", { cx: "9.5", cy: "10.6", r: "1.1", fill: "currentColor", stroke: "none", key: "eye-l" }],
  ["circle", { cx: "14.5", cy: "10.6", r: "1.1", fill: "currentColor", stroke: "none", key: "eye-r" }],
]);
