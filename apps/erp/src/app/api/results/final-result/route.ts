import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@nkps/shared/lib/supabase/server";
import { canViewReportCard } from "@/lib/report-card";
import { computeFinalResult } from "@/lib/final-result";

// GET /api/results/final-result?student_id=&academic_year_id=
// Returns the computed FinalResult as JSON. Useful for diagnostics, admin
// preview before flipping a result master toggle, and for tests that need
// to assert against the computed structure rather than the PDF binary.
//
// Authorisation reuses canViewReportCard so the privacy surface matches
// the report-card PDF route.
export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const params = request.nextUrl.searchParams;
  const studentId = params.get("student_id");
  const academicYearId = params.get("academic_year_id");
  if (!studentId || !academicYearId) {
    return NextResponse.json(
      { error: "student_id and academic_year_id are required" },
      { status: 400 }
    );
  }

  const allowed = await canViewReportCard(supabase, user.id, studentId);
  if (!allowed) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Privacy gate (audit H2): students/parents must only see published marks
  // via the live-compute path. Resolve the caller's role and pass the
  // includeUnpublished flag accordingly.
  const { data: callerProfile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();
  const callerRole = (callerProfile?.role as string | undefined) ?? "";
  const isStaff =
    callerRole === "admin" ||
    callerRole === "staff" ||
    callerRole === "teacher";

  const final = await computeFinalResult(supabase, {
    student_id: studentId,
    academic_year_id: academicYearId,
    includeUnpublished: isStaff,
  });
  if (!final) {
    return NextResponse.json(
      { error: "No result master configured or no recorded marks" },
      { status: 404 }
    );
  }
  return NextResponse.json({ final_result: final });
}
