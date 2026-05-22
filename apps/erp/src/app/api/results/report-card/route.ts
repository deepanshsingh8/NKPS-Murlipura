import { NextResponse } from "next/server";
import { createClient } from "@nkps/shared/lib/supabase/server";
import { canViewReportCard, getReportCardData } from "@/lib/report-card";

export async function GET(request: Request) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const studentId = searchParams.get("student_id");
    const academicYearId = searchParams.get("academic_year_id");

    if (!studentId) {
      return NextResponse.json(
        { error: "student_id is required" },
        { status: 400 }
      );
    }

    const allowed = await canViewReportCard(supabase, user.id, studentId);
    if (!allowed) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const data = await getReportCardData(supabase, studentId, academicYearId);
    if (!data) {
      return NextResponse.json({ error: "Student not found" }, { status: 404 });
    }

    return NextResponse.json(data);
  } catch (err) {
    console.error("Report card API error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
