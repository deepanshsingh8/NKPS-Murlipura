import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { verifyAdminOrEditor } from "@nkps/shared/lib/verify-admin";

const halfDayValues = ["full", "first_half", "second_half"] as const;

const updateSchema = z.object({
  half_day: z.enum(halfDayValues).optional(),
  reason: z.string().max(500).nullable().optional(),
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

  const { data, error } = await admin
    .from("teacher_absences")
    .update(parsed.data)
    .eq("id", id)
    .select(
      "id, teacher_id, absence_date, half_day, reason, marked_by, created_at, updated_at, teachers(id, full_name, employee_id)"
    )
    .single();
  if (error) {
    console.error("[teacher-absences.PATCH] update:", error);
    return NextResponse.json({ error: "Failed to update teacher absence" }, { status: 500 });
  }
  return NextResponse.json({ data });
}

// DELETE cascades to substitutions(absence_id) via FK ON DELETE CASCADE.
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const admin = await verifyAdminOrEditor("teacher_substitutions");
  if (!admin) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;

  const { error } = await admin.from("teacher_absences").delete().eq("id", id);
  if (error) {
    console.error("[teacher-absences.DELETE] delete:", error);
    return NextResponse.json({ error: "Failed to delete teacher absence" }, { status: 500 });
  }
  return NextResponse.json({ data: { id } });
}
