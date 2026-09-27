import { NextRequest, NextResponse } from "next/server";
import { verifyAdminOrEditorWithUser } from "@nkps/shared/lib/verify-admin";
import { getStudentHistory } from "@/lib/student-history";

// GET /api/students/[id]/history
//
// Every academic year the student has been enrolled for, with that year's
// results, attendance, fees and marksheet publications. Gated on the same
// `students` feature key as the rest of the section — featureKeyForPath
// resolves /people/students/<id> by href prefix, so the page needs no new
// entry in the permission catalog.
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await verifyAdminOrEditorWithUser("students");
    if (!auth) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;
    if (!id) {
      return NextResponse.json({ error: "Student id required" }, { status: 400 });
    }

    const history = await getStudentHistory(auth.admin, id);
    if (!history.student) {
      return NextResponse.json({ error: "Student not found" }, { status: 404 });
    }

    return NextResponse.json(history);
  } catch (err) {
    console.error("[students.history.GET]", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
