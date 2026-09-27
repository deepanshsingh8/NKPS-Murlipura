// Checks for summariseFeeCollection() in apps/erp/src/lib/fees.ts — the roll-up
// behind the dashboard's Fee Collection card.
//
// It guards two failures the card actually shipped with:
//
//   1. The numerator and the denominator described different things. Cash was
//      summed over every receipt in the session, including money paid ahead of
//      schedule, and divided by what had fallen due — so "collected / due" and
//      "outstanding dues" could not be reconciled by anyone reading the card,
//      and a school where every family paid the year up front would have read
//      over 100%.
//   2. A waiver was counted as neither cash nor dues, so the same three
//      numbers disagreed again by exactly the amount written off.
//
// Everything below prices real fee lines through the real computeDuesBreakdown,
// so the fixtures fail if either the schedule maths or the roll-up drifts.
//
//   npx tsx scripts/_test-fee-collection-summary.mts

import {
  computeDuesBreakdown,
  summariseFeeCollection,
  type DuesPaymentRow,
  type FeeCollectionEntry,
} from "../apps/erp/src/lib/fees";
import type { EffectiveFeeLine, FeeStructure } from "../packages/shared/src/types";

let failed = 0;
const t = (label: string, got: unknown, want: unknown) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failed++;
  console.log(
    ok ? `PASS ${label}` : `FAIL ${label}  got ${JSON.stringify(got)} want ${JSON.stringify(want)}`
  );
};

// A session running Apr 2026 - Mar 2027, read on 10 Sep 2026.
const TODAY = "2026-09-10";
const YEAR_START = "2026-04-01";

const instalment = (
  no: number,
  amount: number,
  due: string,
  late: Partial<FeeStructure> = {}
): EffectiveFeeLine =>
  ({
    kind: "fee_structure",
    id: `fs-${no}`,
    academic_year_id: "ay",
    class_name: "V",
    class_level: "i_v",
    stream_id: null,
    fee_type: "Tuition Fee",
    amount,
    due_date: due,
    frequency: "one_time",
    is_active: true,
    description: null,
    instalment_no: no,
    instalment_name: `${no} Instalment`,
    month_label: null,
    student_type: "both",
    late_fee_start_date: null,
    late_fee_percent: 0,
    late_fee_fixed_amount: 0,
    late_fee_per_day: 0,
    late_fee_max: null,
    created_at: "",
    updated_at: "",
    ...late,
  }) as EffectiveFeeLine;

// Two instalments fallen due (Apr, Jul), two still ahead (Oct, Jan):
// billed to date 20,000 of a 40,000 session.
const SCHEDULE: EffectiveFeeLine[] = [
  instalment(1, 10_000, "2026-04-10"),
  instalment(2, 10_000, "2026-07-10"),
  instalment(3, 10_000, "2026-10-10"),
  instalment(4, 10_000, "2027-01-10"),
];

const receipt = (p: Partial<DuesPaymentRow>): DuesPaymentRow => ({
  fee_structure_id: null,
  amount_paid: 0,
  waiver_amount: 0,
  refund_amount: 0,
  ...p,
});

/** One student, priced exactly as the route prices them. */
const student = (
  payments: DuesPaymentRow[],
  lines: EffectiveFeeLine[] = SCHEDULE
): FeeCollectionEntry => ({
  breakdown: computeDuesBreakdown({
    lines,
    payments,
    today: TODAY,
    yearStartDate: YEAR_START,
  }),
  waived: payments.reduce((s, p) => s + Number(p.waiver_amount ?? 0), 0),
});

const paidInFull = () => student([receipt({ amount_paid: 40_000 })]);
const paidNothing = () => student([]);
const waivedInFull = () => student([receipt({ waiver_amount: 20_000 })]);
const paidPart = () => student([receipt({ amount_paid: 5_000 })]);
const partlyRefunded = () =>
  student([receipt({ amount_paid: 10_000, refund_amount: 4_000 })]);

// ── The schedule prices as expected before anything is rolled up ──────────
{
  const b = paidNothing().breakdown;
  t("two of four instalments have fallen due", b.billedToDate, 20_000);
  t("  ...the session is still 40,000", b.expected, 40_000);
}

// ── The reconciliation the card is read for ───────────────────────────────
{
  const s = summariseFeeCollection([
    paidInFull(),
    paidNothing(),
    waivedInFull(),
    paidPart(),
    partlyRefunded(),
  ]);

  t("due so far, five students", s.dueToDate, 100_000);
  t("whole session", s.expected, 200_000);

  // 20,000 settled by the payer-in-full (capped at their own bill), 0 by the
  // defaulter, 20,000 waived, 5,000 part-paid, 6,000 net of the refund.
  t("settled against what is due", s.settled, 51_000);
  t("outstanding", s.dues, 49_000);
  t("settled + dues === due so far", s.settled + s.dues, s.dueToDate);
  t("percentage is settled over due", s.percentage, 51);

  // Cash is a different question: it counts the 20,000 paid ahead of
  // schedule and excludes the waiver entirely.
  t("cash banked", s.collected, 51_000);
  t("  ...of which paid in advance", s.advance, 20_000);
  t("  ...and written off, never banked", s.waived, 20_000);
  t(
    "cash + waived - advance === settled",
    s.collected + s.waived - s.advance,
    s.settled
  );

  t("families clear", s.studentsClear, 2);
  t("families owing", s.studentsWithDues, 3);
  t("families counted", s.studentsTotal, 5);
}

// ── A school that pays the whole year in April reads 100%, not 200% ───────
{
  const s = summariseFeeCollection([paidInFull(), paidInFull(), paidInFull()]);
  t("everyone paid the year up front: settled caps at what is due", s.percentage, 100);
  t("  ...and the cash figure still shows all of it", s.collected, 120_000);
  t("  ...as 60,000 of it running ahead of the schedule", s.advance, 60_000);
  t("  ...with nothing outstanding", s.dues, 0);
  t("  ...and the whole session settled with it", s.percentageOfYear, 100);
}

// ── One family's advance must not cancel another's arrears ────────────────
{
  const s = summariseFeeCollection([paidInFull(), paidNothing()]);
  // Netting school-wide would read 40,000 paid against 40,000 due and report
  // nothing outstanding, with a defaulter sitting in the roll.
  t("advance does not offset arrears", s.dues, 20_000);
  t("  ...and one family is still owing", s.studentsWithDues, 1);
}

// ── A waiver settles a due without any money arriving ─────────────────────
{
  const s = summariseFeeCollection([waivedInFull()]);
  t("waiver clears the dues", s.dues, 0);
  t("  ...but banks no cash", s.collected, 0);
  t("  ...and still shows as settled", s.settled, 20_000);
}

// ── A refund leaves the receipt in place and takes the money back out ─────
{
  const s = summariseFeeCollection([partlyRefunded()]);
  t("refund is netted out of cash", s.collected, 6_000);
  t("  ...and out of what is settled", s.settled, 6_000);
}

// ── Late fee: charged on top of the bill, and named separately ────────────
//
// The route must select these columns off fee_structures — an enumerated
// column list that omitted late_fee_percent priced every surcharge at zero
// here while the dues register, which selects "*", charged it, and the two
// screens then disagreed about the same student.
{
  const overdue = [
    instalment(1, 10_000, "2026-04-10", { late_fee_percent: 10 }),
    instalment(2, 10_000, "2026-07-10", { late_fee_percent: 10 }),
  ];
  const s = summariseFeeCollection([student([], overdue)]);
  t("late fee is reported apart from the bill", s.lateFee, 2_000);
  t("  ...and included in what the office chases", s.dues, 22_000);
  t("settled + dues - lateFee === due so far", s.settled + s.dues - s.lateFee, s.dueToDate);

  // Settling everything billed stops the surcharge — computeDuesBreakdown
  // drops it once the bill is covered, and the register reads it the same way.
  // The card must not invent a family to chase over a lapsed late fee.
  const caughtUp = summariseFeeCollection([
    student([receipt({ amount_paid: 20_000 })], overdue),
  ]);
  t("paying the bill clears the surcharge with it", caughtUp.dues, 0);
  t("  ...and no late fee is left standing", caughtUp.lateFee, 0);
  t("  ...so the family counts as clear", caughtUp.studentsClear, 1);
}

// ── Nobody enrolled: zeroes, not NaN ──────────────────────────────────────
{
  const s = summariseFeeCollection([]);
  t("empty cohort percentage", [s.percentage, s.percentageOfYear], [0, 0]);
  t("empty cohort totals", [s.dueToDate, s.dues, s.collected], [0, 0, 0]);
}

console.log(failed === 0 ? "\nall passed" : `\n${failed} failed`);
process.exit(failed ? 1 : 0);
