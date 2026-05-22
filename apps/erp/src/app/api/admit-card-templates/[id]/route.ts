import { NextRequest, NextResponse } from "next/server";
import { verifyAdminOrEditor } from "@nkps/shared/lib/verify-admin";
import { z } from "zod";

const patchSchema = z.object({
  name: z.string().min(1).optional(),
  is_default: z.boolean().optional(),
  orientation: z.enum(["portrait", "landscape"]).optional(),
  background_image_url: z.string().nullable().optional(),
  show_photo: z.boolean().optional(),
  show_admission_no: z.boolean().optional(),
  show_roll_no: z.boolean().optional(),
  show_class_section: z.boolean().optional(),
  show_father_name: z.boolean().optional(),
  show_mother_name: z.boolean().optional(),
  show_dob: z.boolean().optional(),
  show_phone: z.boolean().optional(),
  show_address: z.boolean().optional(),
  show_schedule: z.boolean().optional(),
  show_instructions: z.boolean().optional(),
  instructions_text: z.string().nullable().optional(),
  signature_labels: z.array(z.string()).optional(),
  is_active: z.boolean().optional(),
});

type RouteContext = { params: Promise<{ id: string }> };

export async function PATCH(request: NextRequest, context: RouteContext) {
  const admin = await verifyAdminOrEditor("admit_cards");
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
    .from("admit_card_templates")
    .select("id, is_default")
    .eq("id", id)
    .maybeSingle();
  if (!current) {
    return NextResponse.json({ error: "Template not found" }, { status: 404 });
  }

  // Promote to default: unset the existing default first.
  if (parsed.data.is_default === true && !current.is_default) {
    await admin
      .from("admit_card_templates")
      .update({ is_default: false })
      .eq("is_default", true);
  }

  // Demoting the current default directly would leave zero defaults — block
  // and ask admin to promote another first (same pattern as grade scales).
  if (parsed.data.is_default === false && current.is_default) {
    return NextResponse.json(
      {
        error:
          "Cannot unset the default directly. Promote another template to default — this one will auto-demote.",
      },
      { status: 409 }
    );
  }

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  for (const [k, v] of Object.entries(parsed.data)) {
    if (v !== undefined) patch[k] = v;
  }

  const { data, error } = await admin
    .from("admit_card_templates")
    .update(patch)
    .eq("id", id)
    .select("*")
    .single();
  if (error) {
    console.error("[admit-card-templates.PATCH] update:", error);
    return NextResponse.json({ error: "Failed to update admit card template" }, { status: 500 });
  }
  return NextResponse.json({ data });
}

export async function DELETE(_request: NextRequest, context: RouteContext) {
  const admin = await verifyAdminOrEditor("admit_cards");
  if (!admin) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await context.params;

  const { data: current } = await admin
    .from("admit_card_templates")
    .select("id, is_default")
    .eq("id", id)
    .maybeSingle();
  if (!current) {
    return NextResponse.json({ error: "Template not found" }, { status: 404 });
  }
  if (current.is_default) {
    const { data: candidates } = await admin
      .from("admit_card_templates")
      .select("id, name")
      .neq("id", id)
      .order("name", { ascending: true });
    return NextResponse.json(
      {
        error:
          "Cannot delete the default admit card template. Promote another template first.",
        code: "DEFAULT_TEMPLATE_PROTECTED",
        candidates: candidates ?? [],
      },
      { status: 409 }
    );
  }

  const { error } = await admin
    .from("admit_card_templates")
    .delete()
    .eq("id", id);
  if (error) {
    console.error("[admit-card-templates.DELETE] delete:", error);
    return NextResponse.json({ error: "Failed to delete admit card template" }, { status: 500 });
  }
  return NextResponse.json({ data: { id } });
}
