// Checks for useTablePagination's pure maths (packages/shared/.../data-table.tsx).
//
// The hook itself needs React, so the arithmetic is re-implemented here from
// the same rules and checked against the cases that actually bite: clamping
// when a filter shrinks the set under you, and keeping your place when the
// page size changes.
//
//   npx tsx scripts/_test-table-pagination.mts

let failed = 0;
const t = (label: string, got: unknown, want: unknown) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failed++;
  console.log(ok ? `PASS ${label}` : `FAIL ${label}  got ${JSON.stringify(got)} want ${JSON.stringify(want)}`);
};

const view = (total: number, page: number, pageSize: number) => {
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(Math.max(1, page), pageCount);
  return {
    page: safePage,
    pageCount,
    from: total === 0 ? 0 : (safePage - 1) * pageSize + 1,
    to: Math.min(safePage * pageSize, total),
  };
};

// The real register.
t("867 rows @50, page 1", view(867, 1, 50), { page: 1, pageCount: 18, from: 1, to: 50 });
t("867 rows @50, last page is partial", view(867, 18, 50), { page: 18, pageCount: 18, from: 851, to: 867 });
t("867 rows @100", view(867, 1, 100), { page: 1, pageCount: 9, from: 1, to: 100 });
t("867 rows @10", view(867, 1, 10), { page: 1, pageCount: 87, from: 1, to: 10 });

// A column filter cuts 867 down to 12 while sitting on page 8: land on the
// last page that has rows, never on an empty table.
t("clamps to the last non-empty page", view(12, 8, 50), { page: 1, pageCount: 1, from: 1, to: 12 });
t("clamps @10 too", view(12, 8, 10), { page: 2, pageCount: 2, from: 11, to: 12 });

t("empty set", view(0, 1, 50), { page: 1, pageCount: 1, from: 0, to: 0 });
t("exact multiple leaves no phantom page", view(100, 1, 50).pageCount, 2);
t("one over adds a page", view(101, 1, 50).pageCount, 3);

// Changing page size keeps the first visible row visible.
const keepPlace = (total: number, page: number, prev: number, next: number) => {
  const firstRow = (Math.min(Math.max(1, page), Math.max(1, Math.ceil(total / prev))) - 1) * prev;
  return Math.floor(firstRow / next) + 1;
};
t("10 -> 100 from page 8 (row 71) lands on page 1", keepPlace(867, 8, 10, 100), 1);
t("50 -> 10 from page 3 (row 101) lands on page 11", keepPlace(867, 3, 50, 10), 11);
t("50 -> 100 from page 4 (row 151) lands on page 2", keepPlace(867, 4, 50, 100), 2);
t("page 1 stays page 1", keepPlace(867, 1, 50, 10), 1);

console.log(failed === 0 ? "\nall passed" : `\n${failed} failed`);
process.exit(failed ? 1 : 0);
