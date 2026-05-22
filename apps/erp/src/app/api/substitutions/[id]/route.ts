import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { verifyAdminOrEditor } from "@nkps/shared/lib/verify-admin";

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
