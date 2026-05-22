import { NextResponse } from "next/server";
import { verifyAdminOrEditor } from "@nkps/shared/lib/verify-admin";

/**
 * Set or clear a student's pick for a given elective slot (5 or 6).
 *
 * POST { student_id, slot, subject_id }
 *   - Validates that subject_id is a registered option for that slot.
 *   - Upserts into student_elective_picks (one row per student + slot).
 *
 * DELETE ?student_id=…&slot=…
 *   - Removes the pick for that slot.
 *
 * Note: this table is independent of class_subjects. The ERP's existing model
 * (subjects inferred from class_subjects) still applies for compulsory subjects.
 */

export async function POST(request: Request) {
  const admin = await verifyAdminOrEditor("students");
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await request.json();
  const studentId = String(body?.student_id ?? "");
  const slot = Number(body?.slot);
  const subjectId = String(body?.subject_id ?? "");

  if (!studentId || !subjectId) {
    return NextResponse.json({ error: "student_id and subject_id required" }, { status: 400 });
  }
  if (!Number.isInteger(slot) || slot < 1 || slot > 9) {
    return NextResponse.json({ error: "slot must be 1–9" }, { status: 400 });
  }

  // Verify the option is valid for the slot
  const { data: opt } = await admin
    .from("elective_slot_options")
    .select("id")
    .eq("slot", slot)
    .eq("subject_id", subjectId)
    .eq("is_active", true)
    .maybeSingle();
  if (!opt) {
    return NextResponse.json({ error: "Subject is not an option for this elective slot" }, { status: 400 });
  }

  const { error: upsertErr } = await admin
    .from("student_elective_picks")
    .upsert(
      { student_id: studentId, slot, subject_id: subjectId, updated_at: new Date().toISOString() },
      { onConflict: "student_id,slot" }
    );
  if (upsertErr) {
    return NextResponse.json({ error: upsertErr.message }, { status: 400 });
  }

  return NextResponse.json({ ok: true });
}

export async function DELETE(request: Request) {
  const admin = await verifyAdminOrEditor("students");
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const url = new URL(request.url);
  const studentId = url.searchParams.get("student_id");
  const slot = Number(url.searchParams.get("slot"));
  if (!studentId || !Number.isInteger(slot)) {
    return NextResponse.json({ error: "student_id and slot required" }, { status: 400 });
  }
  const { error } = await admin
    .from("student_elective_picks")
    .delete()
    .eq("student_id", studentId)
    .eq("slot", slot);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true });
}
