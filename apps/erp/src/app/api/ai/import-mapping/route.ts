import { NextRequest, NextResponse } from "next/server";
import { verifyStaffMember } from "@nkps/shared/lib/verify-admin";
import { getSchoolProfile } from "@nkps/shared/lib/school-profile";
import { rateLimit } from "@nkps/shared/lib/rate-limit";
import { isAiConfigured } from "@/lib/ai/client";
import { proposeMapping, type FieldCandidate } from "@/lib/ai/import-mapper";
import type { ColumnProfile } from "@nkps/shared/lib/import-mapping";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * POST /api/ai/import-mapping — match leftover spreadsheet columns to fields.
 *
 * Deliberately generic: the caller sends the candidate fields it wants matched
 * along with the column profiles, so all nine import dialogs can use this one
 * endpoint without a server change each time. That is safe because the
 * response is only ever a mapping of column index to field key, applied by the
 * client to its own local parse — there is no server-side effect, and the
 * commit still goes through the existing validated import endpoint.
 *
 * No values reach this route. The client profiles each column into a shape
 * first — see describeColumn.
 */
export async function POST(request: NextRequest) {
  if (!isAiConfigured()) {
    return NextResponse.json(
      { error: "The assistant is not configured on this deployment.", code: "NOT_CONFIGURED" },
      { status: 503 }
    );
  }

  const caller = await verifyStaffMember();
  if (!caller) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const limit = rateLimit({
    name: "ai:import-mapping",
    key: caller.user.id,
    max: 20,
    windowSeconds: 300,
  });
  if (!limit.ok) {
    return NextResponse.json(
      { error: `Try again in ${limit.resetSeconds}s.`, code: "RATE_LIMITED" },
      { status: 429 }
    );
  }

  const school = await getSchoolProfile(caller.admin);
  if (!school.aiEnabled) {
    return NextResponse.json(
      { error: "The assistant is switched off for this school.", code: "AI_DISABLED" },
      { status: 503 }
    );
  }

  let body: { columns?: unknown; candidates?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const columns = (Array.isArray(body.columns) ? body.columns : []) as ColumnProfile[];
  const candidates = (Array.isArray(body.candidates) ? body.candidates : []) as FieldCandidate[];

  if (columns.length === 0 || candidates.length === 0) {
    return NextResponse.json({ suggestions: [] });
  }
  if (columns.length > 120 || candidates.length > 250) {
    return NextResponse.json({ error: "That file has too many columns." }, { status: 400 });
  }

  // Belt and braces. describeColumn should never produce a `values` array for
  // a high-cardinality column, but this route is the last thing between a
  // browser and an external API, so it re-applies the rule rather than
  // trusting a client it does not control.
  const safeColumns: ColumnProfile[] = columns.map((c) => ({
    header: String(c.header ?? "").slice(0, 120),
    index: Number(c.index) || 0,
    filled: Number(c.filled) || 0,
    distinct: Number(c.distinct) || 0,
    shape: String(c.shape ?? "").slice(0, 60),
    minLength: Number(c.minLength) || 0,
    maxLength: Number(c.maxLength) || 0,
    ...(Array.isArray(c.values) && c.values.length > 0 && c.values.length <= 12
      ? { values: c.values.slice(0, 12).map((v) => String(v).slice(0, 24)) }
      : {}),
  }));

  try {
    const suggestions = await proposeMapping({ columns: safeColumns, candidates });
    return NextResponse.json({ suggestions });
  } catch (err) {
    console.error("[ai.import-mapping] failed:", err);
    return NextResponse.json(
      { error: "Couldn't match those columns. Map them by hand instead." },
      { status: 500 }
    );
  }
}
