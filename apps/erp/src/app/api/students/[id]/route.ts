import { NextResponse } from "next/server";
import { verifyAdminOrEditor } from "@nkps/shared/lib/verify-admin";

/**
 * GET /api/students/[id]
 *
 * One student's complete `students` row.
 *
 * The counterpart to the narrow projection the listing now returns (see
 * LIST_STUDENT_COLUMNS in ../route.ts): the list carries the dozen columns the
 * table, its search and its row actions read, and every surface driven by the
 * shared template registry — the edit form and the read-only detail drawer —
 * reads the whole record from here when the reader actually opens it. Sending
 * all 98 columns for 944 students so that one of them might be edited was 2.4
 * MB down the wire on every page load.
 *
 * Gated on the same `students` feature key as the rest of the section, using
 * the same helper as `../route.ts` and `[id]/export`. `featureKeyForPath`
 * resolves it by href prefix, so no new entry in the permission catalog.
 */
export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const admin = await verifyAdminOrEditor("students");
    if (!admin) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await context.params;
    if (!id) {
      return NextResponse.json({ error: "Student id required" }, { status: 400 });
    }

    const { data, error } = await admin
      .from("students")
      .select("*")
      .eq("id", id)
      .maybeSingle();

    if (error) {
      console.error("[students.[id].GET]", error);
      return NextResponse.json(
        { error: "Failed to fetch student" },
        { status: 500 }
      );
    }
    if (!data) {
      return NextResponse.json({ error: "Student not found" }, { status: 404 });
    }

    return NextResponse.json({ data });
  } catch (err) {
    console.error("[students.[id].GET]", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
