#!/usr/bin/env node
/**
 * Every navigable ERP screen must have an entry in the guide registry.
 *
 * A screen that ships without guidance is not a neutral gap — the assistant
 * still gets asked about it, and an assistant with no grounding for a screen
 * either says "I don't know about that page", which reads as broken, or worse,
 * invents a plausible button. This is the check that stops the second one.
 *
 * A script rather than a test because this repo has no test runner. Run it
 * after touching the sidebar or the registry:
 *
 *   node scripts/check-guide-coverage.mjs
 */

import { readFileSync } from "node:fs";

const SIDEBARS = [
  "apps/erp/src/components/ErpSidebar.tsx",
  "apps/erp/src/components/portal/TeacherSidebar.tsx",
];
const REGISTRY = "packages/shared/src/lib/guide/screens.ts";

const hrefs = new Set();
for (const file of SIDEBARS) {
  const src = readFileSync(file, "utf8");
  for (const m of src.matchAll(/href:\s*"([^"]+)"/g)) {
    // Query strings are a view of the same screen, not a different one.
    hrefs.add(m[1].split("?")[0]);
  }
}

const registry = readFileSync(REGISTRY, "utf8");
const covered = new Set(
  [...registry.matchAll(/^\s{4}path:\s*"([^"]+)"/gm)].map((m) => m[1])
);

const missing = [...hrefs].filter((h) => !covered.has(h)).sort();
const orphans = [...covered].filter((p) => !hrefs.has(p)).sort();

if (orphans.length) {
  // Not a failure: some screens are reachable without a sidebar link.
  console.log(`note: ${orphans.length} guide entries have no sidebar link`);
  for (const p of orphans) console.log(`      ${p}`);
}

if (missing.length) {
  console.error(
    `\nFAIL: ${missing.length} navigable screen(s) have no guide entry.\n` +
      `Add them to ${REGISTRY} — with real control labels, read off the page.\n`
  );
  for (const p of missing) console.error(`  ${p}`);
  process.exit(1);
}

console.log(
  `\nOK: all ${hrefs.size} sidebar destinations are covered by ${covered.size} guide entries.`
);
