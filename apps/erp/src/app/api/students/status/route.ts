import { NextRequest, NextResponse } from "next/server";
import { verifyAdminOrEditor } from "@nkps/shared/lib/verify-admin";
import { enrollmentStatusSchema } from "@nkps/shared/lib/validations";
import { z } from "zod";

const bulkStatusSchema = z.object({
  updates: z.array(
    z.object({
      enrollment_id: z.string().uuid(),
      status: enrollmentStatusSchema,
    })
  ).min(1, "At least one update required"),
});

export async function PATCH(request: NextRequest) {
  try {
    const admin = await verifyAdminOrEditor("students");
    if (!admin) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const result = bulkStatusSchema.safeParse(body);

    if (!result.success) {
      return NextResponse.json(
        { error: "Invalid data", details: result.error.flatten() },
        { status: 400 }
      );
    }

    const { updates } = result.data;
    const errors: string[] = [];

    // Statuses that put the student in an inactive lifecycle state (left or
    // dismissed). Anything else (active / passed / failed) implies the student
    // is still part of the school for some purpose, so the parent record must
    // flip back to is_active=true on reactivation — otherwise the unfiltered
    // students listing (which gates on students.is_active) silently drops them
    // even after the enrollment row says active.
    const INACTIVE_STATUSES = new Set(["terminated", "exited"]);

    const deactivateEnrollmentIds = updates
      .filter((u) => INACTIVE_STATUSES.has(u.status))
      .map((u) => u.enrollment_id);
    const reactivateEnrollmentIds = updates
      .filter((u) => !INACTIVE_STATUSES.has(u.status))
      .map((u) => u.enrollment_id);

    // Group updates by status so we issue one UPDATE per distinct status value
    // instead of N individual round-trips.
    const byStatus = new Map<string, string[]>();
    for (const u of updates) {
      const ids = byStatus.get(u.status) ?? [];
      ids.push(u.enrollment_id);
      byStatus.set(u.status, ids);
    }

    let successCount = 0;
    for (const [status, ids] of byStatus.entries()) {
      const { error, count } = await admin
        .from("student_enrollments")
        .update({ status }, { count: "exact" })
        .in("id", ids);

      if (error) {
        console.error("Enrollment status bulk update failed:", error);
        errors.push(`Failed to update ${ids.length} enrollment(s) to status "${status}"`);
      } else {
        successCount += count ?? ids.length;
      }
    }

    // For terminated/exited: deactivate the student record
    if (deactivateEnrollmentIds.length > 0) {
      // Look up student_ids from enrollment_ids
      const { data: enrollments } = await admin
        .from("student_enrollments")
        .select("student_id")
        .in("id", deactivateEnrollmentIds);

      if (enrollments && enrollments.length > 0) {
        const studentIds = [...new Set(enrollments.map((e) => e.student_id))];
        await admin
          .from("students")
          .update({ is_active: false, updated_at: new Date().toISOString() })
          .in("id", studentIds);
      }
    }

    // For active/passed/failed coming back from a terminated/exited state:
    // re-activate the parent student row so the unfiltered listing surfaces
    // them again. Roll numbers are recomputed by the existing
    // trg_enrollment_update_recompute trigger on student_enrollments, so we
    // don't have to call the recompute RPC by hand.
    if (reactivateEnrollmentIds.length > 0) {
      const { data: enrollments } = await admin
        .from("student_enrollments")
        .select("student_id")
        .in("id", reactivateEnrollmentIds);

      if (enrollments && enrollments.length > 0) {
        const studentIds = [...new Set(enrollments.map((e) => e.student_id))];
        await admin
          .from("students")
          .update({ is_active: true, updated_at: new Date().toISOString() })
          .in("id", studentIds);
      }
    }

    return NextResponse.json({
      success: true,
      updated: successCount,
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (err) {
    console.error("Update student status error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
