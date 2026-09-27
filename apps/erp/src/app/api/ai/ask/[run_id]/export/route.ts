import { NextRequest, NextResponse } from "next/server";
import { verifyAdminOrEditorWithUser } from "@nkps/shared/lib/verify-admin";
import { contentDispositionAttachment, csvEscape } from "@nkps/shared/lib/utils";
import { rerunQueryRun, logAiExport } from "@/lib/ai/rerun";

export const runtime = "nodejs";

/**
 * GET /api/ai/ask/[run_id]/export — the answer as a CSV.
 *
 * A download is a different act from a screen read: this is data leaving the
 * school, so it writes an export_events row with source='ai' alongside every
 * manual export. `dataset` stays 'students' — same corpus, different route.
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

  const { headers, body, total, fieldKeys, sensitive, academicYearId, filters } = outcome.data;

  await logAiExport({
    admin: caller.admin,
    user: caller.user,
    role: caller.role,
    runId,
    format: "csv",
    academicYearId,
    rowCount: total,
    fieldKeys,
    sensitive,
    filters,
    request,
  });

  const lines = [
    headers.map(csvEscape).join(","),
    ...body.map((row) => row.map(csvEscape).join(",")),
  ];
  // BOM so Excel on Windows reads Devanagari names correctly.
  const csv = `﻿${lines.join("\r\n")}`;

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": contentDispositionAttachment("assistant-report.csv"),
      "Cache-Control": "no-store",
    },
  });
}
