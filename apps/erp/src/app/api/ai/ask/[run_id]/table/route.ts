import { NextRequest, NextResponse } from "next/server";
import { verifyAdminOrEditorWithUser } from "@nkps/shared/lib/verify-admin";
import { rerunQueryRun } from "@/lib/ai/rerun";

export const runtime = "nodejs";

/**
 * GET /api/ai/ask/[run_id]/table — the full result behind an answer.
 *
 * The model never saw these rows; it worked from counts and a short preview.
 * This is where the actual data reaches the screen, so it re-authenticates and
 * re-derives scope rather than trusting the run id as a bearer token.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ run_id: string }> }
) {
  const caller = await verifyAdminOrEditorWithUser("reports");
  if (!caller) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { run_id: runId } = await params;
  const outcome = await rerunQueryRun(
    caller.admin,
    runId,
    { kind: "all" },
    caller.role === "admin",
    // Ownership. The scope check above cannot stand in for it: every holder of
    // the `reports` grant resolves to {kind:"all"}, so the hash always matches
    // and a run id would otherwise work for anyone who had it.
    { ownerId: caller.user.id }
  );

  if (!outcome.ok) {
    return NextResponse.json(
      { error: outcome.error.message, code: outcome.error.code },
      { status: outcome.error.status }
    );
  }

  const url = new URL(request.url);
  const page = Math.max(1, Number(url.searchParams.get("page") ?? 1) || 1);
  const pageSize = Math.min(200, Math.max(1, Number(url.searchParams.get("page_size") ?? 50) || 50));
  const start = (page - 1) * pageSize;

  return NextResponse.json({
    headers: outcome.data.headers,
    rows: outcome.data.body.slice(start, start + pageSize),
    // Re-stated from this run, not carried over from the preview: the data may
    // have moved since the question was asked.
    total: outcome.data.total,
    page,
    page_size: pageSize,
  });
}
