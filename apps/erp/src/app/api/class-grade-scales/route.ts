import { NextRequest, NextResponse } from "next/server";
import { verifyAdmin } from "@nkps/shared/lib/verify-admin";
import { z } from "zod";

const putSchema = z.object({
  class_id: z.string().uuid("Invalid class_id"),
  grade_scale_id: z.string().uuid().nullable(),
});

export async function GET() {
  const admin = await verifyAdmin();
  if (!admin) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data, error } = await admin
    .from("class_grade_scales")
    .select("class_id, grade_scale_id, updated_at");

  if (error) {
    console.error("[class-grade-scales.GET] list:", error);
    return NextResponse.json({ error: "Failed to load class grade scales" }, { status: 500 });
  }

  return NextResponse.json({ data });
}

export async function PUT(request: NextRequest) {
  const admin = await verifyAdmin();
  if (!admin) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const parsed = putSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid data", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const { class_id, grade_scale_id } = parsed.data;

  if (grade_scale_id === null) {
    // Clear override — class falls back to the scope's default scale.
    const { error } = await admin
      .from("class_grade_scales")
      .delete()
      .eq("class_id", class_id);

    if (error) {
      console.error("[class-grade-scales.PUT] delete:", error);
      return NextResponse.json({ error: "Failed to clear class grade scale" }, { status: 500 });
    }
    return NextResponse.json({ data: { class_id, grade_scale_id: null } });
  }

  const { error } = await admin
    .from("class_grade_scales")
    .upsert(
      { class_id, grade_scale_id, updated_at: new Date().toISOString() },
      { onConflict: "class_id" }
    );

  if (error) {
    console.error("[class-grade-scales.PUT] upsert:", error);
    return NextResponse.json({ error: "Failed to update class grade scale" }, { status: 500 });
  }

  return NextResponse.json({ data: { class_id, grade_scale_id } });
}
