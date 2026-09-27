import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { verifyAdminOrEditorWithUser } from "@nkps/shared/lib/verify-admin";
import {
  ROW_DEPENDENCIES,
  countRowDependencies,
} from "@nkps/shared/lib/row-dependencies";
import { TABLE_FEATURE_KEY } from "@/lib/admin-tables";

/**
 * Pre-flight for a delete: what is this master row still holding up?
 *
 * The admin proxy refuses a delete that would strand academic records, but a
 * refusal after the admin has already confirmed is a bad screen to be on. This
 * endpoint lets the page ask first, so the confirmation can either name what
 * will be removed or explain up front why Deactivate is the right action.
 *
 * Counts run on the service-role client (see countRowDependencies) — the same
 * client and the same map the proxy gate uses, so the two can never disagree.
 */
export async function GET(request: NextRequest) {
  const table = request.nextUrl.searchParams.get("table") ?? "";
  const id = request.nextUrl.searchParams.get("id") ?? "";

  if (!ROW_DEPENDENCIES[table]) {
    return NextResponse.json({ error: "Table not allowed" }, { status: 403 });
  }
  if (!id) {
    return NextResponse.json({ error: "id required" }, { status: 400 });
  }

  const auth = await verifyAdminOrEditorWithUser(TABLE_FEATURE_KEY[table]);
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const report = await countRowDependencies(auth.admin, table, id);
  return NextResponse.json(report);
}
