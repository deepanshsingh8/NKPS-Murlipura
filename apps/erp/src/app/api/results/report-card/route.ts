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

    // Sessions this student was actually enrolled for, so the portal can offer
    // a year picker without a second endpoint or a wider permission surface.
    // Returned newest-first; RLS already scopes the caller to their own rows,
    // and canViewReportCard above has scoped them to this student.
    const { data: enrolledYears } = await supabase
      .from("student_enrollments")
      .select("academic_year_id, academic_years(id, name, start_date, is_current)")
      .eq("student_id", studentId);

    const seen = new Set<string>();
    const available_years = (enrolledYears ?? [])
      .map((row) => {
        const y = row.academic_years as unknown as
          | { id: string; name: string; start_date: string | null; is_current: boolean }
          | { id: string; name: string; start_date: string | null; is_current: boolean }[]
          | null;
        return Array.isArray(y) ? (y[0] ?? null) : y;
      })
      .filter((y): y is NonNullable<typeof y> => Boolean(y && !seen.has(y.id) && seen.add(y.id)))
      .sort((a, b) => (b.start_date ?? "").localeCompare(a.start_date ?? ""));

    return NextResponse.json({ ...data, available_years });
  } catch (err) {
    console.error("Report card API error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
