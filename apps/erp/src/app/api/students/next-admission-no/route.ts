import { NextResponse } from "next/server";
import { verifyAdminOrEditor } from "@nkps/shared/lib/verify-admin";

/**
 * GET /api/students/next-admission-no
 *
 * Suggests the next admission number for the Add Student form: the highest
 * purely-numeric admission number across ALL students (including alumni —
 * their numbers must never be reused) plus one. Schools with alphanumeric
 * schemes still get a suggestion from the numeric portion of their records,
 * and the field stays editable — this is a convenience, not an allocator,
 * so a rare race simply surfaces as the existing duplicate-number 409.
 */
export async function GET() {
  try {
    const admin = await verifyAdminOrEditor("students");
    if (!admin) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Scan admission numbers to find the numeric maximum. The range must clear
    // the true row count (active + all alumni), not PostgREST's 1000-row
    // default: a truncated window returns an arbitrary subset that can miss the
    // real maximum and suggest an already-used number. 100k comfortably covers
    // a school's full lifetime enrolment; only one lightweight text column is
    // fetched. (A DB-side aggregate RPC would avoid the transfer entirely if the
    // table ever grows past this — the field is an editable suggestion backed by
    // the admission_no UNIQUE constraint, so a stale value only costs a retry.)
    const { data, error } = await admin
      .from("students")
      .select("admission_no")
      .range(0, 99999);

    if (error) {
      console.error("[students.next-admission-no]", error);
      return NextResponse.json({ error: "Failed to compute" }, { status: 500 });
    }

    let max = 0;
    for (const row of data ?? []) {
      const no = String(row.admission_no).trim();
      if (/^\d+$/.test(no)) max = Math.max(max, parseInt(no, 10));
    }

    return NextResponse.json({ next: String(max > 0 ? max + 1 : 1001) });
  } catch (err) {
    console.error("[students.next-admission-no]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
