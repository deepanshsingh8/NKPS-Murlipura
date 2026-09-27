import { NextRequest, NextResponse } from "next/server";
import { verifyAdminOrEditor } from "@nkps/shared/lib/verify-admin";

/**
 * Teacher lifecycle — the retire / reinstate action behind People → Teachers.
 *
 * A dedicated route rather than the generic `adminApi()` proxy because one
 * retirement has to touch two tables: the `teachers` row (which every ERP
 * dropdown reads) and the linked `staff_members` row (which the public website
 * staff listing reads). Doing it through the single-table proxy would leave a
 * retired teacher still listed on the school's public site, which is the
 * mirror image of the bug this whole phase exists to fix. (migration 116)
 *
 * There is no DELETE handler, on purpose. `timetable_periods.teacher_id` and
 * `class_subjects.teacher_id` have no ON DELETE rule, so deleting a teacher who
 * has ever been timetabled fails with 23503 — and if it succeeded it would
 * erase the record of who taught what. Retiring is the only supported exit.
 */

// GET /api/teachers?scope=all|active|inactive|review
// `review` returns the teachers_needing_review view — active teacher rows with
// no staff record and no portal login, i.e. the residue of a staff deletion.
export async function GET(request: NextRequest) {
  const admin = await verifyAdminOrEditor("staff");
  if (!admin) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const scope = request.nextUrl.searchParams.get("scope") ?? "all";

  if (scope === "review") {
    const { data, error } = await admin
      .from("teachers_needing_review")
      .select("*")
      .order("full_name");
    if (error) {
      console.error("[teachers.GET] review view:", error);
      return NextResponse.json(
        { error: "Failed to load the review queue" },
        { status: 500 }
      );
    }
    return NextResponse.json({ data: data ?? [] });
  }

  let query = admin
    .from("teachers")
    .select(
      "id, employee_id, full_name, email, phone, date_of_joining, date_of_leaving, leaving_reason, is_active, staff_member_id, specialization"
    )
    .order("full_name");
  if (scope === "active") query = query.eq("is_active", true);
  if (scope === "inactive") query = query.eq("is_active", false);

  const { data, error } = await query;
  if (error) {
    console.error("[teachers.GET] list:", error);
    return NextResponse.json({ error: "Failed to load teachers" }, { status: 500 });
  }
  return NextResponse.json({ data: data ?? [] });
}

// PATCH /api/teachers  { id, is_active, leaving_reason?, date_of_leaving? }
export async function PATCH(request: NextRequest) {
  const admin = await verifyAdminOrEditor("staff");
  if (!admin) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: {
    id?: unknown;
    is_active?: unknown;
    leaving_reason?: unknown;
    date_of_leaving?: unknown;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const id = typeof body.id === "string" ? body.id : "";
  if (!id) {
    return NextResponse.json({ error: "id is required" }, { status: 400 });
  }
  if (typeof body.is_active !== "boolean") {
    return NextResponse.json(
      { error: "is_active must be true or false" },
      { status: 400 }
    );
  }
  const isActive = body.is_active;

  const { data: teacher, error: loadErr } = await admin
    .from("teachers")
    .select("id, full_name, staff_member_id, date_of_leaving")
    .eq("id", id)
    .maybeSingle();
  if (loadErr) {
    console.error("[teachers.PATCH] load:", loadErr);
    return NextResponse.json({ error: "Failed to load teacher" }, { status: 500 });
  }
  if (!teacher) {
    return NextResponse.json({ error: "Teacher not found" }, { status: 404 });
  }

  const today = new Date().toISOString().slice(0, 10);
  const patch: Record<string, unknown> = {
    is_active: isActive,
    updated_at: new Date().toISOString(),
  };

  if (isActive) {
    // Reinstating clears the reason but keeps date_of_leaving: a rejoin is
    // part of the record, and blanking it would hide that they ever left.
    patch.leaving_reason = null;
  } else {
    const supplied =
      typeof body.date_of_leaving === "string" && body.date_of_leaving
        ? body.date_of_leaving
        : null;
    if (supplied && !/^\d{4}-\d{2}-\d{2}$/.test(supplied)) {
      return NextResponse.json(
        { error: "date_of_leaving must be YYYY-MM-DD" },
        { status: 400 }
      );
    }
    patch.date_of_leaving = supplied ?? teacher.date_of_leaving ?? today;
    patch.leaving_reason =
      typeof body.leaving_reason === "string" && body.leaving_reason.trim()
        ? body.leaving_reason.trim().slice(0, 500)
        : null;
  }

  const { error: updateErr } = await admin
    .from("teachers")
    .update(patch)
    .eq("id", id);
  if (updateErr) {
    console.error("[teachers.PATCH] update:", updateErr);
    return NextResponse.json({ error: "Failed to update teacher" }, { status: 500 });
  }

  // Carry the change to the linked staff record so the public staff listing
  // and the Staff page agree with the ERP. Logged, not fatal — the teacher
  // side is what the dropdowns read, and that has already succeeded.
  let staffSynced = false;
  if (teacher.staff_member_id) {
    const { error: staffErr } = await admin
      .from("staff_members")
      .update({ is_active: isActive, updated_at: new Date().toISOString() })
      .eq("id", teacher.staff_member_id);
    if (staffErr) {
      console.error("[teachers.PATCH] staff mirror:", staffErr);
    } else {
      staffSynced = true;
    }
  }

  return NextResponse.json({ success: true, staff_synced: staffSynced });
}
