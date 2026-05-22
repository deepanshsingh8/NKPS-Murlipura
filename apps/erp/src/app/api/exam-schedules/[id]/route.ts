import { NextRequest, NextResponse } from "next/server";
import { verifyAdmin } from "@nkps/shared/lib/verify-admin";
import { z } from "zod";

const patchSchema = z.object({
  exam_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  start_time: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/).nullable().optional(),
  end_time: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/).nullable().optional(),
  room: z.string().nullable().optional(),
  invigilator_teacher_id: z.string().uuid().nullable().optional(),
  sort_order: z.number().int().min(0).optional(),
  notes: z.string().nullable().optional(),
});

type RouteContext = { params: Promise<{ id: string }> };

export async function PATCH(request: NextRequest, context: RouteContext) {
  const admin = await verifyAdmin();
  if (!admin) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await context.params;
  const body = await request.json();
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid data", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  for (const [k, v] of Object.entries(parsed.data)) {
    if (v !== undefined) patch[k] = v;
  }

  const { data, error } = await admin
    .from("exam_schedules")
    .update(patch)
    .eq("id", id)
    .select("*")
    .single();
  if (error) {
    console.error("[exam-schedules.PATCH] update:", error);
    return NextResponse.json({ error: "Failed to update exam schedule" }, { status: 500 });
  }
  return NextResponse.json({ data });
}

export async function DELETE(_request: NextRequest, context: RouteContext) {
  const admin = await verifyAdmin();
  if (!admin) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await context.params;
  const { error } = await admin
    .from("exam_schedules")
    .delete()
    .eq("id", id);
  if (error) {
    console.error("[exam-schedules.DELETE] delete:", error);
    return NextResponse.json({ error: "Failed to delete exam schedule" }, { status: 500 });
  }
  return NextResponse.json({ data: { id } });
}
