// Read every row of a query, not the first thousand.
//
// PostgREST caps every response at the server's `db-max-rows`, which Supabase
// ships as 1000. A `Range` header cannot raise that cap — it can only ask for
// less. So this, which appears throughout the codebase, does not do what its
// comments say it does:
//
//   .range(0, 9999)   // "clears PostgREST's 1000-row default"
//
// It returns 1000 rows and a 200. No error, no warning, no partial-content
// signal the client checks. The query simply stops early and every total
// computed from it is quietly short.
//
// This stayed invisible for as long as every table was under a thousand rows.
// It surfaced when the 2026-27 day book put 1,994 payments into fee_payments:
// the dues register read 1,000 of them and reported 432 students as having
// paid nothing, against Rs 1.02 crore that was sitting in the table the whole
// time. Money that is present but unreadable is indistinguishable, on screen,
// from money that was never received.
//
// The only correct way to read past the cap is to page until a short page
// comes back.

export interface PagedResult<T> {
  data: T[];
  error: string | null;
  /** True when the read stopped at `maxRows` with more rows still available. */
  truncated: boolean;
}

/**
 * Page a Supabase/PostgREST query to completion.
 *
 * `makeQuery` is called once per page with an inclusive row range:
 *
 *   const { data, error } = await fetchAllRows<PayRow>((from, to) =>
 *     supabase.from("fee_payments").select("...").eq("academic_year_id", y).range(from, to)
 *   );
 *
 * A page shorter than `pageSize` ends the read — that is the only reliable
 * end-of-data signal, since a full page is ambiguous.
 *
 * `maxRows` is a runaway guard, not a row budget: hitting it sets `truncated`
 * so a caller computing money can refuse to show a total it knows is short,
 * rather than printing a plausible wrong number.
 */
export async function fetchAllRows<T>(
  makeQuery: (
    from: number,
    to: number
  ) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
  opts: { pageSize?: number; maxRows?: number } = {}
): Promise<PagedResult<T>> {
  // 1000 matches Supabase's default cap. A larger page is silently clipped to
  // it, which would make every page look short and end the read after one.
  const pageSize = Math.max(1, Math.min(opts.pageSize ?? 1000, 1000));
  const maxRows = opts.maxRows ?? 200_000;

  const out: T[] = [];
  for (let from = 0; from < maxRows; from += pageSize) {
    const to = Math.min(from + pageSize, maxRows) - 1;
    const { data, error } = await makeQuery(from, to);
    if (error) return { data: out, error: error.message, truncated: true };
    const page = data ?? [];
    out.push(...page);
    if (page.length < to - from + 1) {
      return { data: out, error: null, truncated: false };
    }
  }
  return { data: out, error: null, truncated: true };
}
