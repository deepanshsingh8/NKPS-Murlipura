#!/usr/bin/env node
/**
 * A browser call to a token-gated API route must actually send the token.
 *
 * The verify-admin helpers authenticate from the Authorization header, not
 * from cookies:
 *
 *     readBearerToken(headersList.get("authorization"))
 *
 * A bare `fetch("/api/fees/payments", …)` reaches them with no header, so they
 * fail closed and the route answers 401 "Unauthorized". Nothing in the UI
 * distinguishes that from a real permission problem, so the screen reports
 * "not authorised" to an admin who is fully authorised — and the operator
 * reasonably concludes their account is wrong rather than the call.
 *
 * That is exactly how every fee write path (Record Payment, Record Waiver,
 * refunds, and an editor's change request) came to be dead for ALL roles,
 * unnoticed, while money went in through the day-book importer instead.
 *
 * `adminFetch()` / `adminUpload()` attach the session token; a hand-rolled
 * `Authorization` header is equally fine. This check fails when neither is
 * present on a call whose route reads the header.
 *
 * A script rather than a test because this repo has no test runner:
 *
 *   node scripts/check-api-auth.mjs
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const CLIENT_ROOT = "apps/erp/src";
const API_ROOT = "apps/erp/src/app/api";

/** Helpers that authenticate from the Authorization header. */
const HEADER_HELPERS = [
  "verifyAdminOrEditorWithUser",
  "verifyAdminOrEditor",
  "verifyAdminWithUser",
  "verifyAdmin",
  "verifyStaffMember",
  "getCallerAccess",
  "verifyPortalUser",
  "verifyPortal",
];

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (name === "node_modules" || name === ".next") continue;
      walk(p, out);
    } else if (/\.(ts|tsx)$/.test(name)) {
      out.push(p);
    }
  }
  return out;
}

/** Resolve "/api/a/b/${id}/c" to its route file, tolerating [param] dirs. */
function resolveRoute(url) {
  const path = url
    .replace(/\$\{[^}]*\}/g, "*")
    .split("?")[0]
    .replace(/^\/api\/?/, "")
    .replace(/\/+$/, "");
  const parts = path ? path.split("/").filter(Boolean) : [];

  const step = (dir, rest) => {
    if (rest.length === 0) {
      for (const f of ["route.ts", "route.tsx"]) {
        try {
          statSync(join(dir, f));
          return join(dir, f);
        } catch {}
      }
      return null;
    }
    const [head, ...tail] = rest;
    let dynamic = null;
    for (const name of readdirSync(dir)) {
      const child = join(dir, name);
      if (!statSync(child).isDirectory()) continue;
      if (name === head) {
        const hit = step(child, tail);
        if (hit) return hit;
      } else if (name.startsWith("[")) {
        dynamic = child; // try literals first, fall back to the param segment
      }
    }
    return dynamic ? step(dynamic, tail) : null;
  };

  try {
    return step(API_ROOT, parts);
  } catch {
    return null;
  }
}

/**
 * Does the handler for `method` in this route file read the Authorization
 * header? Checked per handler, because a route can pair a cookie-authenticated
 * GET with a header-authenticated POST (/api/ptm-formats does exactly that).
 */
function handlerNeedsToken(routeFile, method) {
  const src = readFileSync(routeFile, "utf8");
  const marks = [...src.matchAll(/export\s+async\s+function\s+(GET|POST|PUT|PATCH|DELETE)\b/g)];
  if (marks.length === 0) return false;

  const wanted = marks.find((m) => m[1] === method);
  if (!wanted) return false;
  const start = wanted.index;
  const next = marks.find((m) => m.index > start);
  const body = src.slice(start, next ? next.index : src.length);

  if (/headers\(\)|headers\.get\(\s*["']authorization/i.test(body)) return true;
  return HEADER_HELPERS.some((h) => new RegExp(`\\b${h}\\s*\\(`).test(body));
}

const failures = [];
const files = walk(CLIENT_ROOT).filter((f) => !f.includes("/src/app/api/"));

for (const file of files) {
  const src = readFileSync(file, "utf8");
  // `fetch(` followed (possibly across a line break) by an /api/ literal.
  const calls = src.matchAll(/(?<!admin)\bfetch\(\s*["'`](\/api\/[^"'`]*)["'`]/g);
  for (const m of calls) {
    const url = m[1];
    // The options object, if any, follows the URL — read a generous window.
    const window = src.slice(m.index, m.index + 900);
    const method = (window.match(/method:\s*["'`](\w+)["'`]/) || [, "GET"])[1].toUpperCase();
    if (/Authorization/i.test(window)) continue; // hand-rolled header: fine

    const routeFile = resolveRoute(url);
    if (!routeFile) continue; // external or unresolvable — not ours to judge
    if (!handlerNeedsToken(routeFile, method)) continue;

    const line = src.slice(0, m.index).split("\n").length;
    failures.push({
      file: relative(process.cwd(), file),
      line,
      url,
      method,
      route: relative(process.cwd(), routeFile),
    });
  }
}

if (failures.length > 0) {
  console.error(
    `\nFAIL: ${failures.length} browser call(s) reach a token-gated route without a token.\n` +
      `These answer 401 "Unauthorized" for EVERY role, including admins.\n` +
      `Use adminFetch() from @nkps/shared/lib/admin-api instead of fetch().\n`
  );
  for (const f of failures) {
    console.error(`  ${f.file}:${f.line}`);
    console.error(`      ${f.method} ${f.url}  ->  ${f.route}\n`);
  }
  process.exit(1);
}

console.log("OK: every browser call to a token-gated API route sends its token.");
