import { NextRequest, NextResponse } from "next/server";
import { verifyAdminOrEditorWithUser } from "@nkps/shared/lib/verify-admin";
import { rerunQueryRun } from "@/lib/ai/rerun";
import { scopeHash, type RowScope } from "@/lib/ai/caller-context";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * POST /api/ai/ask/[run_id]/rerun — refresh an expired result.
 *
 * A run handle lasts a day. Reopening last week's chat therefore shows result
 * chips whose handles have lapsed, and this is how they come back: not by
 * reviving the old row, but by executing its stored filters again and writing
 * a NEW one.
 *
 * The distinction matters. The expired row stays expired, so nothing extends
 * the life of a handle that was already issued, and the new row records that a
 * fresh authorization check passed at this moment rather than last week's. The
 * data may also have moved since — a re-run is honestly a different answer to
 * the same question, and the row count it returns says so.
 */
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ run_id: string }> }
) {
  const caller = await verifyAdminOrEditorWithUser("reports");
  if (!caller) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { run_id: runId } = await params;
  const scope: RowScope = { kind: "all" };

  const outcome = await rerunQueryRun(
    caller.admin,
    runId,
    scope,
    caller.role === "admin",
    // Expiry is the one check waived — this endpoint exists because the run
    // expired. Ownership and the scope fingerprint still hold.
    { ownerId: caller.user.id, ignoreExpiry: true }
  );

  if (!outcome.ok) {
    return NextResponse.json(
      { error: outcome.error.message, code: outcome.error.code },
      { status: outcome.error.status }
    );
  }

  const { data, error } = await caller.admin
    .from("ai_query_runs")
    .insert({
      conversation_id: outcome.data.conversationId,
      filters: outcome.data.filters,
      field_keys: outcome.data.fieldKeys,
      total: outcome.data.total,
      capped: outcome.data.total >= 19_999,
      scope_hash: scopeHash(scope),
      academic_year_id: outcome.data.academicYearId,
      // Cloned so the new chip lands under the same answer, wearing the same
      // label. A re-run that detached itself from its turn would leave the
      // transcript with an orphan result and an answer with none.
      message_seq: outcome.data.messageSeq,
      purpose: outcome.data.purpose,
    })
    .select("id")
    .single();

  if (error || !data) {
    console.error("[ai.rerun] could not record the new run:", error?.message);
    return NextResponse.json(
      { error: "Couldn't re-run that result." },
      { status: 500 }
    );
  }

  return NextResponse.json({
    run_id: data.id as string,
    total: outcome.data.total,
    purpose: outcome.data.purpose,
  });
}
