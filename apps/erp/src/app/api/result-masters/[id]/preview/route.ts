import { NextRequest, NextResponse } from "next/server";
import { verifyAdmin } from "@nkps/shared/lib/verify-admin";
import { computeFinalResult } from "@/lib/final-result";

type RouteContext = { params: Promise<{ id: string }> };

// GET /api/result-masters/[id]/preview?student_id=
// Computes the final-result bundle for a single student under the class/year
// the master belongs to. Verifies enrollment first so admin can't preview a
// student who isn't in the master's class.
export async function GET(request: NextRequest, context: RouteContext) {
  const admin = await verifyAdmin();
  if (!admin) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await context.params;

  const { searchParams } = new URL(request.url);
  const studentId = searchParams.get("student_id");
  if (!studentId) {
    return NextResponse.json({ error: "student_id is required" }, { status: 400 });
  }

  const { data: master, error: masterErr } = await admin
    .from("result_masters")
    .select("id, class_id, academic_year_id")
    .eq("id", id)
    .maybeSingle();
  if (masterErr) {
    console.error("[result-master.preview.GET] master fetch:", masterErr);
    return NextResponse.json({ error: "Failed to load result master" }, { status: 500 });
  }
  if (!master) {
    return NextResponse.json({ error: "Result master not found" }, { status: 404 });
  }

  // Enrollment guard: student must be in the master's class for the master's
  // academic year (active enrollment only).
  const { data: enrollment } = await admin
    .from("student_enrollments")
    .select("id, roll_number")
    .eq("student_id", studentId)
    .eq("class_id", master.class_id)
    .eq("academic_year_id", master.academic_year_id)
    .eq("status", "active")
    .maybeSingle();
  if (!enrollment) {
    return NextResponse.json(
      {
        error: "Student is not actively enrolled in this class for the master's academic year",
        code: "STUDENT_NOT_ENROLLED",
      },
      { status: 400 }
    );
  }

  const { data: student, error: studentErr } = await admin
    .from("students")
    .select("id, full_name")
    .eq("id", studentId)
    .maybeSingle();
  if (studentErr) {
    console.error("[result-master.preview.GET] student fetch:", studentErr);
    return NextResponse.json({ error: "Failed to load student" }, { status: 500 });
  }
  if (!student) {
    return NextResponse.json({ error: "Student not found" }, { status: 404 });
  }

  // computeFinalResult accepts any SupabaseClient; the admin client bypasses
  // RLS (we already gated on verifyAdmin above).
  const finalResult = await computeFinalResult(admin, {
    student_id: studentId,
    academic_year_id: master.academic_year_id as string,
  });

  return NextResponse.json({
    final_result: finalResult,
    student: {
      id: student.id,
      full_name: student.full_name,
      roll_number: enrollment.roll_number ?? null,
    },
  });
}
