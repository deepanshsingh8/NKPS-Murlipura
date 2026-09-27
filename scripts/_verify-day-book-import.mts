// End-to-end dry run of a Head-wise Day Book file, offline.
//
// Runs the real parser and the real allocation engine over a real export, with
// a synthetic fee schedule, and checks the two things that must hold before
// this touches a database:
//
//   1. The parse reconciles to the file's own footer, to the rupee.
//   2. Splitting every receipt across instalments preserves every rupee — the
//      sum of the slices equals the sum of the receipts.
//
// It needs no Supabase connection, so it can be run against a file the school
// sends before anyone decides to import it.
//
//   npx tsx scripts/_verify-day-book-import.mts <path-to.xls>

import { readFileSync } from "node:fs";
import { parseHeadWiseDayBook } from "../packages/shared/src/lib/historical-import/parse-head-wise-day-book";
import { normalizeClassName } from "../packages/shared/src/lib/historical-import/class-name-map";
import {
  allocateStudentReceipts,
  groupScheduleByHead,
  type AllocatableStructure,
} from "../apps/erp/src/lib/fee-allocation";

const file = process.argv[2];
if (!file) {
  console.error("usage: npx tsx scripts/_verify-day-book-import.mts <file.xls>");
  process.exit(2);
}

const parsed = parseHeadWiseDayBook(readFileSync(file));
const inr = (n: number) => "Rs " + n.toLocaleString("en-IN");
let failures = 0;
const check = (label: string, ok: boolean, detail = "") => {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? "  " + detail : ""}`);
};

console.log(`\nFile      ${file.split("/").pop()}`);
console.log(`Session   ${parsed.session_label}  (${parsed.period_start} to ${parsed.period_end})`);
console.log(`Heads     ${parsed.heads.join(", ")}`);
console.log(`Receipts  ${parsed.receipts.length}`);
for (const w of parsed.warnings) console.log(`  ! ${w}`);

// ── 1. Parse reconciles to the file's own control totals ──────────────────
console.log("\n── Control totals ──");
const byMode: Record<string, number> = {};
const byHead: Record<string, number> = {};
for (const r of parsed.receipts) {
  byMode[r.payment_method] = (byMode[r.payment_method] ?? 0) + r.total;
  for (const h of r.heads) byHead[h.head] = (byHead[h.head] ?? 0) + h.amount;
}
const grand = parsed.receipts.reduce((a, r) => a + r.total, 0);

check("grand total", grand === parsed.control.grand, `${inr(grand)} vs ${inr(parsed.control.grand ?? 0)}`);
for (const mode of ["cash", "cheque", "online"]) {
  if (parsed.control.by_mode[mode] === undefined) continue;
  check(`mode ${mode}`, (byMode[mode] ?? 0) === parsed.control.by_mode[mode],
    `${inr(byMode[mode] ?? 0)} vs ${inr(parsed.control.by_mode[mode])}`);
}
for (const head of parsed.heads) {
  check(`head ${head}`, (byHead[head] ?? 0) === parsed.control.by_head[head],
    `${inr(byHead[head] ?? 0)} vs ${inr(parsed.control.by_head[head] ?? 0)}`);
}

// ── 2. Rows that would block a commit ─────────────────────────────────────
console.log("\n── Row health ──");
const rowErrors = parsed.receipts.filter((r) => r.errors.length > 0);
const zeros = parsed.receipts.filter((r) => r.total === 0);
const unmapped = [...new Set(parsed.receipts.map((r) => r.raw_class))].filter(
  (c) => !normalizeClassName(c)
);
const noSr = parsed.receipts.filter((r) => !r.admission_no);
check("no structural row errors", rowErrors.length === 0, `${rowErrors.length}`);
check("every class name maps", unmapped.length === 0, unmapped.join(", "));
check("every row carries an SR No", noSr.length === 0, `${noSr.length} without`);
console.log(`      ${zeros.length} zero-value receipt(s) would be skipped (worth ${inr(0)})`);
console.log(`      ${new Set(parsed.receipts.map((r) => r.admission_no)).size} distinct students`);

// ── 3. Allocation preserves every rupee ───────────────────────────────────
// A synthetic schedule per class: each head's total for that class split into
// three equal instalments. The point is not to model the school's real
// amounts, it is to force heavy splitting — a payment that spans two or three
// instalments is exactly where a waterfall would leak paise.
console.log("\n── Allocation ──");
type R = (typeof parsed.receipts)[number];
const byStudent = new Map<string, R[]>();
for (const r of parsed.receipts) {
  if (r.total === 0) continue;
  const k = r.admission_no ?? `row:${r.source_row}`;
  byStudent.set(k, [...(byStudent.get(k) ?? []), r]);
}

const classHeadTotal = new Map<string, number>();
for (const r of parsed.receipts) {
  const cls = normalizeClassName(r.raw_class)?.class_name ?? r.raw_class;
  for (const h of r.heads) {
    const k = `${cls}::${h.head}`;
    classHeadTotal.set(k, (classHeadTotal.get(k) ?? 0) + h.amount);
  }
}
const scheduleForClass = (cls: string) => {
  const rows: AllocatableStructure[] = [];
  for (const head of parsed.heads) {
    const total = classHeadTotal.get(`${cls}::${head}`) ?? 0;
    if (total === 0) continue;
    // Three instalments sized off the class's median receipt, so most
    // payments span more than one row.
    const per = Math.max(1, Math.round(total / 300));
    for (let i = 1; i <= 3; i++) {
      rows.push({
        id: `${cls}::${head}::${i}`,
        fee_type: head,
        amount: per,
        frequency: "one_time",
        due_date: `2026-0${i * 3}-01`,
        instalment_no: i,
        instalment_name: `${i} Instalment`,
        month_label: null,
      } as AllocatableStructure);
    }
  }
  return rows;
};

let sliceTotal = 0;
let receiptTotal = 0;
let sliceCount = 0;
let overAllocated = 0;
let partials = 0;
const problems: string[] = [];
const scheduleCache = new Map<string, Map<string, AllocatableStructure[]>>();

for (const [, receipts] of byStudent) {
  const cls = normalizeClassName(receipts[0].raw_class)?.class_name ?? receipts[0].raw_class;
  if (!scheduleCache.has(cls)) scheduleCache.set(cls, groupScheduleByHead(scheduleForClass(cls)));
  const scheduleByHead = scheduleCache.get(cls)!;

  const { slices, problems: p } = allocateStudentReceipts({
    receipts: receipts.map((r) => ({
      receipt_no: r.receipt_no,
      source_row: r.source_row,
      payment_date: r.payment_date!,
      heads: r.heads,
    })),
    scheduleByHead,
  });
  problems.push(...p.map((x) => `row ${x.source_row}: ${x.message}`));
  for (const s of slices) {
    sliceTotal += s.amount;
    sliceCount++;
    if (s.over_allocated) overAllocated++;
    if (s.partial) partials++;
  }
  for (const r of receipts) receiptTotal += r.total;
}

check("every rupee survives the split",
  Math.round((sliceTotal - receiptTotal) * 100) === 0,
  `slices ${inr(sliceTotal)} vs receipts ${inr(receiptTotal)}`);
check("no head failed to allocate", problems.length === 0, problems.slice(0, 3).join(" | "));
console.log(`      ${sliceCount} payment rows from ${receiptTotal ? byStudent.size : 0} students`);
console.log(`      ${partials} partial slice(s), ${overAllocated} beyond the schedule`);
console.log(
  "      NOTE: the split ratio and the 'beyond the schedule' count are properties\n" +
  "      of the synthetic schedule above, not a forecast. They are deliberately\n" +
  "      aggressive so the waterfall is stress-tested; the real numbers come from\n" +
  "      the importer's own dry run against the published schedule."
);

console.log(failures === 0 ? "\n*** ALL CHECKS PASSED ***\n" : `\n*** ${failures} CHECK(S) FAILED ***\n`);
process.exit(failures === 0 ? 0 : 1);
