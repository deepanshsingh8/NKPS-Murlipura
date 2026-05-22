import { NextRequest, NextResponse } from "next/server";
import { verifyAdmin } from "@nkps/shared/lib/verify-admin";
import { z } from "zod";

const patchSchema = z.object({
  name: z.string().min(1).optional(),
  sort_order: z.number().int().min(0).optional(),
  is_active: z.boolean().optional(),
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
  if (parsed.data.name !== undefined) patch.name = parsed.data.name.trim();
  if (parsed.data.sort_order !== undefined) patch.sort_order = parsed.data.sort_order;
  if (parsed.data.is_active !== undefined) patch.is_active = parsed.data.is_active;

  const { data, error } = await admin
    .from("non_scholastic_subjects")
    .update(patch)
    .eq("id", id)
    .select("id, name, sort_order, is_active")
    .single();
  if (error) {
    console.error("[non-scholastic.subjects.PATCH] update:", error);
    return NextResponse.json({ error: "Failed to update non-scholastic subject" }, { status: 500 });
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
    .from("non_scholastic_subjects")
    .delete()
    .eq("id", id);
  if (error) {
    console.error("[non-scholastic.subjects.DELETE] delete:", error);
    return NextResponse.json({ error: "Failed to delete non-scholastic subject" }, { status: 500 });
  }
  return NextResponse.json({ data: { id } });
}
