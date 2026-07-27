import { NextRequest, NextResponse } from "next/server";
import { verifyAdminOrEditor } from "@nkps/shared/lib/verify-admin";
import { promoteStaffToTeacher } from "@/lib/staff-teacher-sync";
import { isTeachingStaffCategory } from "@nkps/shared/lib/staff-roles";

interface RouteContext {
  params: Promise<{ id: string }>;
}

// POST /api/staff/[id]/convert-to-teacher
// Promotes a staff_members row to also exist as a `teachers` record (linked
// via the staff_member_id FK). Idempotent: if a linked teacher already
// exists, returns its id without creating a duplicate.
//
// The new teacher record copies the personal fields from the staff member
// (name → full_name, email, phone, dob, address, qualifications, photo_url).
// Subsequent edits on either side stay in sync via the mirror helpers.
export async function POST(_request: NextRequest, context: RouteContext) {
  const admin = await verifyAdminOrEditor("staff");
  if (!admin) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await context.params;

  // Only teaching staff can become a teacher record — a front-desk clerk or
  // bus driver has no business appearing as an assignable teacher.
  const { data: member } = await admin
    .from("staff_members")
    .select("category")
    .eq("id", id)
    .maybeSingle();
  if (!member) {
    return NextResponse.json({ error: "Staff member not found" }, { status: 404 });
  }
  if (!isTeachingStaffCategory(member.category as string)) {
    return NextResponse.json(
      { error: "Only teaching staff can be converted to a teacher." },
      { status: 400 }
    );
  }

  const result = await promoteStaffToTeacher(admin, id);
  if ("error" in result) {
    // L3 — don't echo the helper's raw error to the caller; it can leak
    // schema/constraint details. Log the detail for debugging instead.
    console.error("[convert-to-teacher] promote failed:", result.error);
    return NextResponse.json(
      { error: "Failed to convert this staff member to a teacher" },
      { status: 500 }
    );
  }
  return NextResponse.json({
    success: true,
    teacher_id: result.teacher_id,
    created: result.created,
  });
}
