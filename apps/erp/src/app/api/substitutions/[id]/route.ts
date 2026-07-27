import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { verifyAdminOrEditor } from "@nkps/shared/lib/verify-admin";
import { findSubstituteConflict } from "@/lib/substitution-availability";

const updateSchema = z.object({
  substitute_teacher_id: z.string().uuid().optional(),
  note: z.string().max(500).nullable().optional(),
});

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const admin = await verifyAdminOrEditor("teacher_substitutions");
  if (!admin) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;

  const body = await request.json();
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid data", details: parsed.error.flatten() },
      { status: 400 }
    );
  }
  if (Object.keys(parsed.data).length === 0) {
    return NextResponse.json({ error: "No fields to update" }, { status: 400 });
  }

  // Re-checking a changed substitute requires the row's absence + period, so
  // load the existing row first (also gives us a clean 404).
  const { data: existing, error: existingError } = await admin
    .from("substitutions")
    .select("absence_id, timetable_period_id")
    .eq("id", id)
    .maybeSingle();
  if (existingError) {
    console.error("[substitutions.PATCH] load existing:", existingError);
    return NextResponse.json({ error: "Failed to load substitution" }, { status: 500 });
  }
  if (!existing) {
    return NextResponse.json({ error: "Substitution not found" }, { status: 404 });
  }

  // Availability re-check when the substitute is being changed — the write path
  // must not trust the client and assign an absent or already-booked teacher.
  if (parsed.data.substitute_teacher_id) {
    const conflict = await findSubstituteConflict(admin, {
      substituteTeacherId: parsed.data.substitute_teacher_id,
      absenceId: existing.absence_id,
      timetablePeriodId: existing.timetable_period_id,
    });
    if (conflict) {
      return NextResponse.json({ error: conflict }, { status: 409 });
    }
  }

  const { data, error } = await admin
    .from("substitutions")
    .update(parsed.data)
    .eq("id", id)
    .select("id, absence_id, timetable_period_id, substitute_teacher_id, note, updated_at")
    .single();
  if (error) {
    console.error("[substitutions.PATCH] update:", error);
    return NextResponse.json({ error: "Failed to update substitution" }, { status: 500 });
  }
  return NextResponse.json({ data });
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const admin = await verifyAdminOrEditor("teacher_substitutions");
  if (!admin) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;

  const { error } = await admin.from("substitutions").delete().eq("id", id);
  if (error) {
    console.error("[substitutions.DELETE] delete:", error);
    return NextResponse.json({ error: "Failed to delete substitution" }, { status: 500 });
  }
  return NextResponse.json({ data: { id } });
}
