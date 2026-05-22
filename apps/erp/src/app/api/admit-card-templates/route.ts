import { NextRequest, NextResponse } from "next/server";
import { verifyAdminOrEditor } from "@nkps/shared/lib/verify-admin";
import { z } from "zod";

const templateSchema = z.object({
  name: z.string().min(1, "Name required"),
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

export async function GET() {
  const admin = await verifyAdminOrEditor("admit_cards");
  if (!admin) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { data, error } = await admin
    .from("admit_card_templates")
    .select("*")
    .order("is_default", { ascending: false })
    .order("name", { ascending: true });
  if (error) {
    console.error("[admit-card-templates.GET] list:", error);
    return NextResponse.json({ error: "Failed to load admit card templates" }, { status: 500 });
  }
  return NextResponse.json({ data });
}

export async function POST(request: NextRequest) {
  const admin = await verifyAdminOrEditor("admit_cards");
  if (!admin) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const body = await request.json();
  const parsed = templateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid data", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  // If this one is flagged default, unset the current default first — partial
  // unique index enforces the invariant but we need to flip them in order.
  if (parsed.data.is_default) {
    await admin
      .from("admit_card_templates")
      .update({ is_default: false })
      .eq("is_default", true);
  }

  const { data, error } = await admin
    .from("admit_card_templates")
    .insert({
      ...parsed.data,
      signature_labels:
        parsed.data.signature_labels ?? ["Principal", "Exam Controller"],
    })
    .select("*")
    .single();
  if (error) {
    console.error("[admit-card-templates.POST] insert:", error);
    return NextResponse.json({ error: "Failed to create admit card template" }, { status: 500 });
  }
  return NextResponse.json({ data });
}
