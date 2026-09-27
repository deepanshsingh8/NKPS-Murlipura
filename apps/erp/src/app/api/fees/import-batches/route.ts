// GET /api/fees/import-batches
//
// Lists the import batches so the admin UI can offer a revert. Until
// migration 115 the batch id existed only as a uuid on the imported rows and
// was shown once in a toast, which is why /api/fees/historical-revert has
// never had a caller — there was nowhere to get the id from an hour later.
//
// Admin-only, matching the revert endpoint it feeds: an editor with the 'fees'
// grant may run an import, but the audit trail and the undo are the admin's.

import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { createAdminClient } from "@nkps/shared/lib/supabase/admin";

/**
 * The projection this route returns. Spelled out because the Supabase client
 * has no generated types for import_batches (the repo does not generate them),
 * so the query's inferred row type is unusable.
 */
interface ImportBatchRow {
  id: string;
  kind: string;
  academic_year_id: string | null;
  file_name: string | null;
  file_size_bytes: number | null;
  source_period_start: string | null;
  source_period_end: string | null;
  row_count: number;
  created_count: number;
  skipped_count: number;
  amount_total: number | null;
  control_totals: unknown;
  notes: string | null;
  created_at: string;
  created_by: string | null;
  reverted_at: string | null;
  reverted_by: string | null;
  academic_years: { name: string } | null;
}

const KINDS = [
  "fees_day_book",
  "fees_account_wise",
  "results_greensheet",
  "students_backfill",
] as const;

export async function GET(req: NextRequest) {
  const headerList = await headers();
  const token = (headerList.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const admin = createAdminClient();
  const { data: userData, error: userErr } = await admin.auth.getUser(token);
  if (userErr || !userData?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { data: profile } = await admin
    .from("profiles")
    .select("role, must_change_password")
    .eq("id", userData.user.id)
    .maybeSingle();
  if (!profile || profile.must_change_password || profile.role !== "admin") {
    return NextResponse.json(
      { error: "Forbidden — admin role required" },
      { status: 403 }
    );
  }

  const { searchParams } = new URL(req.url);
  const kind = searchParams.get("kind");
  const academicYearId = searchParams.get("academic_year_id");
  const limit = Math.min(Math.max(Number(searchParams.get("limit") ?? 25), 1), 100);

  if (kind && !KINDS.includes(kind as (typeof KINDS)[number])) {
    return NextResponse.json(
      { error: `kind must be one of ${KINDS.join(", ")}` },
      { status: 400 }
    );
  }

  let query = admin
    .from("import_batches")
    .select(
      "id, kind, academic_year_id, file_name, file_size_bytes, source_period_start, " +
        "source_period_end, row_count, created_count, skipped_count, amount_total, " +
        "control_totals, notes, created_at, created_by, reverted_at, reverted_by, " +
        "academic_years(name)"
    )
    .order("created_at", { ascending: false })
    .limit(limit);

  if (kind) query = query.eq("kind", kind);
  if (academicYearId) query = query.eq("academic_year_id", academicYearId);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const batches = (data ?? []) as unknown as ImportBatchRow[];

  // Actor names are resolved with a second query rather than an embedded
  // join: import_batches has two FKs into profiles (created_by, reverted_by),
  // so an embed needs the constraint name to disambiguate and fails opaquely
  // if that name ever changes. A uuid must never reach the screen, so this
  // path stays boring.
  const actorIds = [
    ...new Set(
      batches.flatMap((b) =>
        [b.created_by, b.reverted_by].filter((v): v is string => typeof v === "string")
      )
    ),
  ];
  const nameById = new Map<string, string>();
  if (actorIds.length > 0) {
    const { data: people } = await admin
      .from("profiles")
      .select("id, full_name")
      .in("id", actorIds);
    for (const p of people ?? []) nameById.set(p.id as string, p.full_name as string);
  }

  return NextResponse.json({
    batches: batches.map((b) => ({
      ...b,
      created_by_name: b.created_by ? nameById.get(b.created_by) ?? "Unknown" : null,
      reverted_by_name: b.reverted_by ? nameById.get(b.reverted_by) ?? "Unknown" : null,
    })),
  });
}
