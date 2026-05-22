import { NextRequest, NextResponse } from "next/server";
import { verifyAdmin } from "@nkps/shared/lib/verify-admin";
import { resultMasterUpdateSchema } from "@nkps/shared/lib/validations";
import { validatePassCriteria } from "@/lib/result-master-validation";

type RouteContext = { params: Promise<{ id: string }> };

const IMMUTABLE_FIELDS = [
  "id",
  "class_id",
  "academic_year_id",
  "created_at",
  "updated_at",
] as const;

// PATCH /api/result-masters/[id]
// Partial update. Immutable fields are rejected with 400 before Zod parse.
// Validates pass_criteria_type against SUPPORTED_PASS_CRITERIA_TYPES and the
// config shape against the type (via validatePassCriteria).
export async function PATCH(request: NextRequest, context: RouteContext) {
  const admin = await verifyAdmin();
  if (!admin) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await context.params;

  const body = await request.json();
  if (body && typeof body === "object") {
    const present = IMMUTABLE_FIELDS.filter((k) => k in body);
    if (present.length > 0) {
      return NextResponse.json(
        {
          error: `Cannot update immutable field${present.length === 1 ? "" : "s"}: ${present.join(", ")}`,
        },
        { status: 400 }
      );
    }
  }

  const parsed = resultMasterUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid data", details: parsed.error.flatten() },
      { status: 400 }
    );
  }
  const data = parsed.data;

  // If either criteria field is present in this PATCH, we need the effective
  // pair (patched fields + existing DB values) to validate consistently.
  if (data.pass_criteria_type !== undefined || data.pass_criteria_config !== undefined) {
    let effectiveType = data.pass_criteria_type;
    let effectiveConfig = data.pass_criteria_config;
    if (effectiveType === undefined || effectiveConfig === undefined) {
      const { data: current } = await admin
        .from("result_masters")
        .select("pass_criteria_type, pass_criteria_config")
        .eq("id", id)
        .maybeSingle();
      if (!current) {
        return NextResponse.json({ error: "Result master not found" }, { status: 404 });
      }
      effectiveType = effectiveType ?? (current.pass_criteria_type as string);
      effectiveConfig =
        effectiveConfig ?? ((current.pass_criteria_config ?? {}) as Record<string, unknown>);
    }
    const err = validatePassCriteria(effectiveType!, effectiveConfig!);
    if (err) return NextResponse.json({ error: err }, { status: 400 });
  }

  // Build the update payload (explicit updated_at since there's no DB trigger).
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  for (const [key, value] of Object.entries(data)) {
    if (value !== undefined) patch[key] = value;
  }

  const { data: updated, error } = await admin
    .from("result_masters")
    .update(patch)
    .eq("id", id)
    .select("*")
    .single();
  if (error) {
    console.error("[result-masters.PATCH] update:", error);
    return NextResponse.json({ error: "Failed to update result master" }, { status: 500 });
  }
  if (!updated) {
    return NextResponse.json({ error: "Result master not found" }, { status: 404 });
  }

  return NextResponse.json({ data: updated });
}

// DELETE /api/result-masters/[id]
// FK cascade on result_master_subjects handles child cleanup.
export async function DELETE(_request: NextRequest, context: RouteContext) {
  const admin = await verifyAdmin();
  if (!admin) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await context.params;

  const { error } = await admin.from("result_masters").delete().eq("id", id);
  if (error) {
    console.error("[result-masters.DELETE] delete:", error);
    return NextResponse.json({ error: "Failed to delete result master" }, { status: 500 });
  }
  return NextResponse.json({ success: true });
}
