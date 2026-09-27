#!/usr/bin/env node
/**
 * Keep the PWA shell version in one piece.
 *
 * The icons regenerate under the same filenames, so the URLs come out
 * byte-different and string-identical. Nothing downstream can see that:
 * Android's WebAPK updater compares the manifest it installed against the one
 * it refetches, finds the same three `src` values and keeps the old launcher
 * icon, and every cache in between has the same reason to sit still. A new
 * crest shipped in 31cb00e and reached nobody who had already installed.
 *
 * `ICON_VERSION` (packages/shared/src/lib/pwa-manifest.ts) is the fix: it
 * versions the icon URLs, and it names the service-worker shell cache, so one
 * bump both invalidates the URLs and drops the cache still holding the
 * previous PNGs. Two of those three places are static files in public/ that
 * cannot import the constant, which is exactly how they drifted the first
 * time — `sw.js` kept `-v1` through the icon change, so `activate`, which only
 * deletes caches whose key differs from the current one, deleted nothing.
 *
 * This is the check that stops them drifting again. It is a script rather than
 * a test because this repo has no test runner:
 *
 *   node scripts/check-pwa-icons.mjs
 *
 * What it will not tell you is whether the PNGs themselves changed. Nothing
 * can. Bumping ICON_VERSION after running scripts/generate-pwa-icons.mjs is a
 * human step, and the generator says so at the top.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const MANIFEST = "packages/shared/src/lib/pwa-manifest.ts";
const APPS = ["erp", "cms"];

const problems = [];
const read = (p) => readFileSync(join(ROOT, p), "utf8");

// ── The one source of truth ──────────────────────────────────────────────────
const manifestSrc = read(MANIFEST);
const declared = /export const ICON_VERSION = "(\d+)";/.exec(manifestSrc);
if (!declared) {
  console.error(
    `\nFAIL: ${MANIFEST} has no \`export const ICON_VERSION = "<n>"\`.\n` +
      `  That constant is what versions the icon URLs and names the service\n` +
      `  worker's shell cache. Without it nothing here can be checked.\n`
  );
  process.exit(1);
}
const version = declared[1];

// ── Every icon URL the manifest emits must carry it ──────────────────────────
// A literal "/icons/..." in this file is one that skipped iconUrl(), and an
// unversioned manifest entry is the whole bug: it is what the WebAPK updater
// compares and finds unchanged.
for (const [i, line] of manifestSrc.split("\n").entries()) {
  if (line.includes("/icons/") && !line.includes("`/icons/${file}?v=")) {
    problems.push({
      file: MANIFEST,
      line: i + 1,
      msg: "icon URL written out literally — use iconUrl() so it carries the version",
      text: line.trim(),
    });
  }
}

// ── Both service workers must name their cache for the same version ──────────
for (const app of APPS) {
  const rel = `apps/${app}/public/sw.js`;
  const src = read(rel);
  const lines = src.split("\n");
  const idx = lines.findIndex((l) => l.includes("const CACHE_VERSION"));
  const found = /const CACHE_VERSION = "nkps-[a-z]+-v(\d+)";/.exec(src);

  if (!found) {
    problems.push({
      file: rel,
      line: idx + 1 || 1,
      msg: 'no `const CACHE_VERSION = "nkps-<app>-v<n>"` to check',
      text: idx >= 0 ? lines[idx].trim() : "(not found)",
    });
    continue;
  }
  if (found[1] !== version) {
    problems.push({
      file: rel,
      line: idx + 1,
      msg:
        `cache is v${found[1]} but ICON_VERSION is ${version} — the stale shell, ` +
        `icons included, is never dropped`,
      text: lines[idx].trim(),
    });
  }
}

if (problems.length) {
  console.error(`\nFAIL: ${problems.length} PWA shell version problem(s).\n`);
  for (const p of problems) {
    console.error(`  ${p.file}:${p.line}`);
    console.error(`    ${p.text}`);
    console.error(`    → ${p.msg}\n`);
  }
  console.error(
    `  Regenerated the icons? Bump ICON_VERSION in ${MANIFEST}\n` +
      `  and the -vN on CACHE_VERSION in each apps/*/public/sw.js to match.\n`
  );
  process.exit(1);
}

console.log(
  `OK: PWA shell is v${version} in the manifest and in ` +
    `${APPS.length} service worker(s).`
);
