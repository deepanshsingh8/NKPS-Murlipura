import { NextRequest, NextResponse } from "next/server";
import { verifyAdmin } from "@nkps/shared/lib/verify-admin";
import { z } from "zod";

const bandSchema = z.object({
  label: z.string().min(1),
  min_pct: z.number().min(0).max(100),
  max_pct: z.number().min(0).max(100),
  remark: z.string().nullable().optional(),
  sort_order: z.number().int().min(0).default(0),
});

const patchSchema = z.object({
  name: z.string().min(1).optional(),
  is_default: z.boolean().optional(),
  bands: z.array(bandSchema).min(1).optional(),
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

  const { data: current } = await admin
    .from("grade_scales")
    .select("id, scope, is_default")
    .eq("id", id)
    .maybeSingle();

  if (!current) {
    return NextResponse.json({ error: "Scale not found" }, { status: 404 });
  }

  // Atomic-enough default promotion. Partial unique index enforces only one
  // default per scope; we unset the old default before setting the new one
  // so the update doesn't collide with itself.
  if (parsed.data.is_default === true && !current.is_default) {
    await admin
      .from("grade_scales")
      .update({ is_default: false })
      .eq("scope", current.scope)
      .eq("is_default", true);
  }

  // Block unsetting the default directly — admin must promote another scale
  // first (which will unset this one as a side effect of the partial index).
  if (parsed.data.is_default === false && current.is_default) {
    return NextResponse.json(
      {
        error:
          "Cannot unset default directly. Promote another scale to default — this one will auto-demote.",
      },
      { status: 409 }
    );
  }

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (parsed.data.name !== undefined) patch.name = parsed.data.name;
  if (parsed.data.is_default !== undefined) patch.is_default = parsed.data.is_default;

  const { data: updated, error } = await admin
    .from("grade_scales")
    .update(patch)
    .eq("id", id)
    .select("id, name, scope, is_default, updated_at")
    .single();

  if (error) {
    console.error("[grade-scales.PATCH] update:", error);
    return NextResponse.json({ error: "Failed to update grade scale" }, { status: 500 });
  }

  // If bands supplied, replace them wholesale (simplest correct semantics
  // for the two-panel editor UI).
  if (parsed.data.bands) {
    await admin.from("grade_bands").delete().eq("grade_scale_id", id);
    const bandRows = parsed.data.bands.map((b, idx) => ({
      grade_scale_id: id,
      label: b.label,
      min_pct: b.min_pct,
      max_pct: b.max_pct,
      remark: b.remark ?? null,
      sort_order: b.sort_order ?? idx,
    }));
    const { error: bandErr } = await admin.from("grade_bands").insert(bandRows);
    if (bandErr) {
      console.error("[grade-scales.PATCH] bands replace:", bandErr);
      return NextResponse.json({ error: "Failed to update grade bands" }, { status: 500 });
    }
  }

  return NextResponse.json({ data: updated });
}

export async function DELETE(_request: NextRequest, context: RouteContext) {
  const admin = await verifyAdmin();
  if (!admin) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await context.params;

  const { data: current } = await admin
    .from("grade_scales")
    .select("id, scope, is_default")
    .eq("id", id)
    .maybeSingle();

  if (!current) {
    return NextResponse.json({ error: "Scale not found" }, { status: 404 });
  }

  if (current.is_default) {
    // Surface candidate scales for the guided-promotion dialog.
    const { data: candidates } = await admin
      .from("grade_scales")
      .select("id, name")
      .eq("scope", current.scope)
      .neq("id", id)
      .order("name", { ascending: true });

    return NextResponse.json(
      {
        error:
          "Cannot delete the default grade scale. Promote another scale to default first.",
        code: "DEFAULT_SCALE_PROTECTED",
        candidates: candidates ?? [],
      },
      { status: 409 }
    );
  }

  // Check if any class is still using this scale via override; the FK is
  // ON DELETE RESTRICT, so the DB would refuse anyway — but a friendlier
  // message than a raw FK error.
  const { count } = await admin
    .from("class_grade_scales")
    .select("class_id", { count: "exact", head: true })
    .eq("grade_scale_id", id);

  if ((count ?? 0) > 0) {
    return NextResponse.json(
      {
        error: `Cannot delete: ${count} class${count === 1 ? "" : "es"} currently use this scale as an override. Unassign those first.`,
        code: "SCALE_IN_USE",
      },
      { status: 409 }
    );
  }

  const { error } = await admin.from("grade_scales").delete().eq("id", id);
  if (error) {
    console.error("[grade-scales.DELETE] delete:", error);
    return NextResponse.json({ error: "Failed to delete grade scale" }, { status: 500 });
  }

  return NextResponse.json({ data: { id } });
}
