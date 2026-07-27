import { NextResponse } from "next/server";
import { createClient } from "@nkps/shared/lib/supabase/server";
import { createAdminClient } from "@nkps/shared/lib/supabase/admin";
import { canViewReportCard } from "@/lib/report-card";
import { getStudentOutstandingDues } from "@/lib/student-dues";

export const runtime = "nodejs";

// Outstanding fee dues for a student, for the admit-card/result download gate.
// Authorized for the people allowed to view that student (self, parent of the
// child, admin/staff-with-results, teacher) via canViewReportCard, so a student
// can only read their own and a parent only their children's.
export async function GET(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const studentId = new URL(request.url).searchParams.get("student_id");
  if (!studentId) {
    return NextResponse.json({ error: "student_id is required" }, { status: 400 });
  }

  const allowed = await canViewReportCard(supabase, user.id, studentId);
  if (!allowed) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const dues = await getStudentOutstandingDues(createAdminClient(), studentId);
    return NextResponse.json(dues);
  } catch (err) {
    console.error("[students.dues.GET]", err);
    return NextResponse.json(
      { error: "Could not determine outstanding dues" },
      { status: 500 }
    );
  }
}
