#!/usr/bin/env node
/**
 * One palette, not twenty-three.
 *
 * A count of Tailwind colour families in the ERP came back with twenty-three.
 * Some of that was real — navy and gold are the brand, gray is structure, and
 * red / amber / green / blue carry the four states everything reports. The
 * rest was drift: `emerald` where `green` already meant success, `rose` where
 * `red` already meant danger, `sky` where `blue` already meant information.
 * The same status came out a different colour depending on which screen you
 * were looking at, and fifteen families existed that the app had no use for.
 *
 * This is the check that stops the twenty-fourth arriving. It is a script
 * rather than a test because this repo has no test runner:
 *
 *   node scripts/check-colors.mjs
 *
 * ── What is allowed ─────────────────────────────────────────────────────────
 *
 *   brand      navy gold cream
 *   structure  gray, plus the shadcn tokens (muted, card, destructive, …)
 *   status     green (success) · amber (warning) · red (danger) · blue (info)
 *   category   cat-1..8   — things that are merely DIFFERENT from each other
 *   ordinal    grade-1..7 — things that are in an ORDER
 *
 * Categorical and ordinal are separate on purpose. A category has no
 * direction, so its hues should be equally spaced and equally loud; a grade
 * ramp has direction, so its hues should march. Using one for the other is
 * how a "C" ends up looking like a warning.
 *
 * ── The opt-out ─────────────────────────────────────────────────────────────
 *
 * A line whose hue genuinely carries information — a module's identity, a
 * five-way role badge where collapsing two keys would merge two roles —
 * carries `color-ok: <reason>` and is skipped. The reason is the point: a
 * marker with no reason is drift with a note on it.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = process.cwd();
const ROOTS = [
  "apps/erp/src",
  "apps/cms/src",
  "packages/shared/src",
  // apps/website is deliberately absent. It has no ThemeProvider and no dark
  // mode, it reports no statuses, and its palette is the marketing one.
];

const ALLOWED = new Set([
  "navy", "gold", "cream", "gray",
  "green", "amber", "red", "blue",
  "white", "black", "transparent", "current", "inherit",
]);

// Properties that take a colour. `divide` and `placeholder` included because
// they drift the same way and are just as invisible in review.
const PROP =
  "(?:bg|text|border|ring|from|to|via|fill|stroke|divide|outline|decoration|accent|shadow|placeholder|caret)";
const FAMILY = /^[a-z]+$/;

// `bg-cat-3/10`, `text-grade-7`, `bg-blue-600`, `dark:border-red-800/40`
const RE = new RegExp(
  `\\b(?:[a-z-]+:)*${PROP}-([a-z]+)(?:-(\\d{2,3}))?(?:\\/\\d+)?\\b`,
  "g"
);

// Whole files exempted, with the reason. These hold tables where the hue IS
// the data — collapsing two entries merges two things the screen exists to
// tell apart.
const EXEMPT_FILES = new Map([
  ["apps/erp/src/app/(admin)/exams/page.tsx",
    "hub tiles: one hue per exam screen, matched by each screen's own header"],
  ["apps/erp/src/app/(admin)/academics/page.tsx",
    "hub tiles: one hue per academics screen"],
  ["apps/erp/src/app/(admin)/transport/page.tsx",
    "hub tiles: one hue per transport screen"],
  ["apps/erp/src/app/(admin)/exams/types/page.tsx",
    "exam-level themes; the level hues are the levels, and its header gradients are two-family by design"],
]);

// The module-accent header tile, in its two shapes — a rounded square in one
// hue with that section's icon on the next line in the same hue:
//
//   <div className="flex h-10 w-10 ... rounded-xl bg-cyan-500/10">
//     <Clock className="h-5 w-5 text-cyan-600 dark:text-cyan-400" />
//
//   <div className="h-10 w-10 rounded-xl bg-violet-100 dark:bg-violet-900/30">
//     <BarChart3 className="h-5 w-5 text-violet-600 dark:text-violet-400" />
//
// Timetable is cyan, Transport teal, Subjects indigo, Calendar rose — one hue
// per module, matching that module's tile on its hub page. It is a real
// system, it is just not a *status* system, and recognising the shape here
// beats sixty hand-written markers all saying the same sentence.
//
// Deliberately tight: the second shape insists on the full `h-10 w-10
// rounded-xl` so it matches the fourteen header tiles in the repo and not
// every `bg-<hue>-100` chip.
const ACCENT_TILE = /bg-([a-z]+)-500\/10|h-10 w-10 rounded-xl bg-([a-z]+)-100/;

// `color-ok: <reason>` — the colon and something after it are both required.
const MARKER = /color-ok:\s*\S/;

function walk(dir, out = []) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const name of entries) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      if (name === "node_modules" || name === ".next") continue;
      walk(full, out);
    } else if (name.endsWith(".tsx") || name.endsWith(".ts")) {
      out.push(full);
    }
  }
  return out;
}

const files = ROOTS.flatMap((r) => walk(join(ROOT, r))).sort();
const findings = [];

for (const full of files) {
  const rel = relative(ROOT, full).split("\\").join("/");
  if (EXEMPT_FILES.has(rel)) continue;

  const lines = readFileSync(full, "utf8").split("\n");
  let accentHue = null;
  lines.forEach((line, i) => {
    // A tile line still sets the hue for the icon below even when it also
    // carries a marker — otherwise a hand-written `color-ok` on the tile
    // orphans its own icon and the icon gets reported.
    const tile = ACCENT_TILE.exec(line);
    // The reason is not decoration. A bare `color-ok` is drift with a note on
    // it, so it does not count as a marker and the line is reported as usual.
    const marked = MARKER.test(line);
    if (line.includes("color-ok") && !marked) {
      findings.push({
        rel,
        line: i + 1,
        family: "(no reason)",
        text: line.trim().slice(0, 100),
      });
    }
    if (tile || marked) {
      accentHue = tile ? (tile[1] ?? tile[2]) : null;
      return;
    }
    // The icon that sits on the tile, one line down, in the same hue.
    if (accentHue && line.includes(`-${accentHue}-`)) {
      accentHue = null;
      return;
    }
    accentHue = null;
    RE.lastIndex = 0;
    let m;
    const seen = new Set();
    while ((m = RE.exec(line))) {
      const family = m[1];
      const step = m[2];
      // `cat-3`, `grade-7` arrive here as family "cat"/"grade".
      if (family === "cat" || family === "grade") continue;
      // No numeric step means a shadcn token (bg-muted, text-destructive) or
      // a keyword (bg-white) — both fine.
      if (!step) continue;
      if (!FAMILY.test(family) || ALLOWED.has(family)) continue;
      if (seen.has(family)) continue;
      seen.add(family);
      findings.push({ rel, line: i + 1, family, text: line.trim().slice(0, 100) });
    }
  });
}

if (findings.length) {
  const byFamily = {};
  for (const f of findings) byFamily[f.family] = (byFamily[f.family] ?? 0) + 1;

  console.error(
    `\nFAIL: ${findings.length} use(s) of a colour family outside the palette.\n`
  );
  console.error(`  ${Object.entries(byFamily)
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `${k} ${v}`)
    .join(", ")}\n`);
  for (const f of findings.slice(0, 30)) {
    console.error(`  ${f.rel}:${f.line}  [${f.family}]`);
    console.error(`    ${f.text}`);
  }
  if (findings.length > 30) {
    console.error(`  … and ${findings.length - 30} more`);
  }
  console.error(
    `\n  Status? Use green / amber / red / blue.\n` +
      `  One of several things that only differ from each other? categoricalChip() (cat-1..8).\n` +
      `  A scale with an order, like grades? gradeChip() (grade-1..7).\n` +
      `  Genuinely carrying information as a hue? Add \`color-ok: <reason>\` on the line.\n`
  );
  process.exit(1);
}

console.log(
  `OK: no off-palette colour families in ${files.length} files ` +
    `(${EXEMPT_FILES.size} exempted by name).`
);
