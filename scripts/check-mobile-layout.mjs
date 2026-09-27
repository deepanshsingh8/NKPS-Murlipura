#!/usr/bin/env node
/**
 * The layout rules that decide whether a form is usable on a phone.
 *
 * Every one of these was a real bug, found by opening the ERP on a phone and
 * seeing two fields sitting on top of each other:
 *
 *   grid       A `grid-cols-2` with no breakpoint is two columns at 375px.
 *              After the sheet's padding that is ~165px per control, and a
 *              native date input will not render that narrow — it overflows
 *              its track and lands on its neighbour. Use <FieldRow>, or add
 *              an `sm:` prefix and start from one column.
 *
 *   vh         `vh` resolves against iOS Safari's *large* viewport — the one
 *              that includes the URL bar you cannot see past. A sheet capped
 *              at 85vh is therefore taller than the screen, and its footer
 *              buttons sit underneath the browser chrome. `dvh` is the unit
 *              that tracks the visible viewport.
 *
 *   select     A raw <select> carries whatever height and font size its author
 *              typed, and every one of them typed `h-9 text-sm`: a 36px touch
 *              target (44px is the minimum) at 14px (iOS zooms the viewport
 *              when a focused control is under 16px, and does not zoom back).
 *              Use <NativeSelect>, which is the same native element dressed to
 *              match the rest of the form.
 *
 *   input      Same story. Use <Input>.
 *
 * A script rather than a test because this repo has no test runner:
 *
 *   node scripts/check-mobile-layout.mjs            # check
 *   node scripts/check-mobile-layout.mjs --update   # re-record the baseline
 *
 * The baseline exists because these rules were written against a codebase that
 * already violated them ~150 times. It records what each file is still allowed
 * to have so CI stays honest while the backlog is worked down; a file may never
 * get *worse*, and a file not listed must be clean. Deleting the last baseline
 * entry is the goal.
 */

import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = process.cwd();
const BASELINE = "scripts/mobile-layout-baseline.json";
const ROOTS = [
  "apps/erp/src",
  "apps/cms/src",
  "apps/website/src",
  "packages/shared/src",
];

// The primitives are where the raw elements are *supposed* to live — they are
// the thing every other file is being told to use instead.
const PRIMITIVES = [
  "packages/shared/src/components/ui/input.tsx",
  "packages/shared/src/components/ui/native-select.tsx",
  "packages/shared/src/components/ui/select.tsx",
  "packages/shared/src/components/ui/textarea.tsx",
  "packages/shared/src/components/ui/checkbox.tsx",
  "packages/shared/src/components/ui/field.tsx",
  "packages/shared/src/components/ui/dialog.tsx",
];

const RULES = [
  {
    id: "grid",
    // Not preceded by `:` (a breakpoint or state variant) or `-` (part of a
    // longer token). grid-cols-1 is fine; it is already the mobile answer.
    re: /(^|[\s"'`{])grid-cols-([2-9]|1[0-2])\b/g,
    // `grid-cols-2 md:grid-cols-4` is someone who thought about the phone and
    // decided two stat tiles fit — which they do. `grid grid-cols-2 gap-3` is
    // someone who never considered it. Naming any breakpoint on the same line
    // is the difference, and it is what separates a deliberate compact layout
    // from the ~90 form rows that shipped two date inputs at 165px each.
    skipLine: /\b(?:sm|md|lg|xl|2xl):grid-cols-/,
    hint: "unprefixed grid-cols-N — use <FieldRow> or grid-cols-1 sm:grid-cols-N",
  },
  {
    id: "vh",
    // `\d+vh` cannot match `100dvh`/`100svh`: the digits are followed by d/s.
    re: /\b\d+(?:\.\d+)?vh\b/g,
    hint: "vh unit — use dvh so iOS's visible viewport is what counts",
  },
  {
    id: "select",
    re: /<select[\s>]/g,
    hint: "raw <select> — use <NativeSelect> for a 44px, 16px control",
  },
  {
    id: "input",
    re: /<input[\s>]/g,
    // Only text-entry controls. A checkbox, a radio, a file picker, a colour
    // swatch and a hidden field have nothing to do with the 44px/16px rules
    // this is about — they are not typed into and iOS does not zoom them.
    // `<input>` with no type at all is a text field, so it counts.
    skipMatch: (src, idx) => {
      const tag = src.slice(idx, idx + 600);
      const close = tag.search(/>|\n\s*\/>/);
      const type = /type="(\w+)"/.exec(close > 0 ? tag.slice(0, close + 200) : tag);
      return type
        ? ["checkbox", "radio", "file", "hidden", "color", "range", "submit"].includes(type[1])
        : false;
    },
    hint: "raw text <input> — use <Input> for h-11/text-base on a phone",
  },
];

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
    } else if (name.endsWith(".tsx")) {
      out.push(full);
    }
  }
  return out;
}

const files = ROOTS.flatMap((r) => walk(join(ROOT, r))).sort();

/** @type {Map<string, {counts: Record<string, number>, lines: string[]}>} */
const found = new Map();

for (const full of files) {
  const rel = relative(ROOT, full).split("\\").join("/");
  if (PRIMITIVES.includes(rel)) continue;

  const src = readFileSync(full, "utf8");
  const srcLines = src.split("\n");
  const counts = {};
  const lines = [];

  for (const rule of RULES) {
    rule.re.lastIndex = 0;
    let m;
    while ((m = rule.re.exec(src))) {
      const lineNo = src.slice(0, m.index).split("\n").length;
      const line = srcLines[lineNo - 1];
      // A month view is seven columns on every device there is. Opt a line
      // out with `mobile-layout-ok` and say why in the same comment.
      if (line.includes("mobile-layout-ok")) continue;
      if (rule.skipLine?.test(line)) continue;
      if (rule.skipMatch?.(src, m.index)) continue;
      counts[rule.id] = (counts[rule.id] ?? 0) + 1;
      lines.push(
        `    ${rel}:${lineNo}  [${rule.id}] ${srcLines[lineNo - 1].trim().slice(0, 96)}`
      );
    }
  }

  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  if (total > 0) found.set(rel, { counts, lines });
}

const total = (c) => Object.values(c).reduce((a, b) => a + b, 0);

if (process.argv.includes("--update")) {
  const next = {};
  for (const [rel, { counts }] of [...found].sort()) next[rel] = counts;
  writeFileSync(join(ROOT, BASELINE), JSON.stringify(next, null, 2) + "\n");
  const violations = [...found.values()].reduce((a, v) => a + total(v.counts), 0);
  console.log(
    `Recorded ${violations} violation(s) across ${found.size} file(s) in ${BASELINE}.`
  );
  process.exit(0);
}

// No baseline file means no allowance: everything must be clean. The file is
// only there while a backlog is being worked down, and this branch finished
// that — it started at 241 violations across 92 files.
let baseline = {};
try {
  baseline = JSON.parse(readFileSync(join(ROOT, BASELINE), "utf8"));
} catch {
  /* clean-slate mode */
}

const regressions = [];
const improvements = [];

for (const [rel, { counts, lines }] of found) {
  const allowed = baseline[rel] ?? {};
  for (const rule of RULES) {
    const now = counts[rule.id] ?? 0;
    const was = allowed[rule.id] ?? 0;
    if (now > was) {
      regressions.push({ rel, rule, now, was, lines });
    }
  }
}

for (const rel of Object.keys(baseline)) {
  const nowCounts = found.get(rel)?.counts ?? {};
  for (const rule of RULES) {
    const now = nowCounts[rule.id] ?? 0;
    const was = baseline[rel][rule.id] ?? 0;
    if (now < was) improvements.push(`${rel} [${rule.id}] ${was} → ${now}`);
  }
}

if (regressions.length) {
  console.error(`\nFAIL: ${regressions.length} mobile-layout regression(s).\n`);
  const seen = new Set();
  for (const r of regressions) {
    console.error(`  ${r.rel}  [${r.rule.id}] ${r.was} → ${r.now}`);
    console.error(`    ${r.rule.hint}`);
    if (!seen.has(r.rel)) {
      seen.add(r.rel);
      for (const l of r.lines.filter((l) => l.includes(`[${r.rule.id}]`)).slice(0, 8)) {
        console.error(l);
      }
    }
    console.error("");
  }
  process.exit(1);
}

if (improvements.length) {
  console.log(`${improvements.length} file/rule pair(s) improved since the baseline:`);
  for (const i of improvements.slice(0, 40)) console.log(`  ${i}`);
  if (improvements.length > 40) console.log(`  … and ${improvements.length - 40} more`);
  console.log(`\nLock it in:  node scripts/check-mobile-layout.mjs --update\n`);
}

const remaining = [...found.values()].reduce((a, v) => a + total(v.counts), 0);
console.log(
  remaining === 0
    ? `OK: no mobile-layout violations in ${files.length} components.`
    : `OK: no regressions. ${remaining} known violation(s) remain across ${found.size} file(s).`
);
