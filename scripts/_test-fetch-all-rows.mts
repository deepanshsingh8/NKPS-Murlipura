// Checks for packages/shared/src/lib/fetch-all-rows.ts.
//
// Guards the bug that made 432 students look like they had paid nothing:
// PostgREST caps every response at db-max-rows (1000 on Supabase) and a
// .range(0, 9999) cannot lift it, so the read stopped early and returned 200.
//
//   npx tsx scripts/_test-fetch-all-rows.mts

import { fetchAllRows } from "../packages/shared/src/lib/fetch-all-rows";

let failed = 0;
const t = (label: string, got: unknown, want: unknown) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failed++;
  console.log(ok ? `PASS ${label}` : `FAIL ${label}  got ${JSON.stringify(got)} want ${JSON.stringify(want)}`);
};

/** A server that hard-caps every response at `cap` rows, exactly as PostgREST does. */
const server = (total: number, cap = 1000) => {
  let calls = 0;
  const q = async (from: number, to: number) => {
    calls++;
    const want = to - from + 1;
    const rows = Array.from({ length: total }, (_, i) => i).slice(from, from + Math.min(want, cap));
    return { data: rows, error: null };
  };
  return { q, calls: () => calls };
};

{ // the exact production shape: 1,994 payment rows behind a 1000 cap
  const s = server(1994);
  const r = await fetchAllRows<number>(s.q);
  t("1994 rows behind a 1000 cap -> all 1994", r.data.length, 1994);
  t("  ...in order", [r.data[0], r.data[1993]], [0, 1993]);
  t("  ...not truncated", r.truncated, false);
  t("  ...took 2 pages", s.calls(), 2);
}
{ // the old behaviour, for contrast: one .range(0, 99999) call
  const s = server(1994);
  const { data } = await s.q(0, 99999);
  t("single .range(0,99999) still returns only the cap", data.length, 1000);
}
{ const r = await fetchAllRows<number>(server(0).q);
  t("empty table", [r.data.length, r.truncated], [0, false]); }
{ const r = await fetchAllRows<number>(server(999).q);
  t("under one page", r.data.length, 999); }
{ const s = server(2000); const r = await fetchAllRows<number>(s.q);
  t("exact multiple of the page size", r.data.length, 2000);
  t("  ...needs the extra probe page to know it ended", s.calls(), 3); }
{ const r = await fetchAllRows<number>(async () => ({ data: null, error: { message: "boom" } }));
  t("error is surfaced, never swallowed", [r.error, r.truncated], ["boom", true]); }
{ const r = await fetchAllRows<number>(server(50_000).q, { maxRows: 3000 });
  t("runaway guard flags truncation", [r.data.length, r.truncated], [3000, true]); }
{ const s = server(2500); const r = await fetchAllRows<number>(s.q, { pageSize: 5000 });
  t("oversized pageSize is clamped to the cap, not silently short", r.data.length, 2500); }

console.log(failed === 0 ? "\nall passed" : `\n${failed} failed`);
process.exit(failed ? 1 : 0);
