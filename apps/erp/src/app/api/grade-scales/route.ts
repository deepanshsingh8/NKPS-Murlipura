import { NextRequest, NextResponse } from "next/server";
import { verifyAdmin } from "@nkps/shared/lib/verify-admin";
import { z } from "zod";

const bandSchema = z.object({
  label: z.string().min(1, "Band label required"),
  min_pct: z.number().min(0).max(100),
  max_pct: z.number().min(0).max(100),
  remark: z.string().nullable().optional(),
  sort_order: z.number().int().min(0).default(0),
});

const createSchema = z.object({
  name: z.string().min(1, "Name required"),
  scope: z.enum(["scholastic", "non_scholastic"]),
  is_default: z.boolean().optional().default(false),
  bands: z
    .array(bandSchema)
    .min(1, "At least one grade band required")
    .refine(
      (bands) => bands.every((b) => b.min_pct <= b.max_pct),
      "Each band's min_pct must be ≤ max_pct"
    ),
});

export async function GET() {
  const admin = await verifyAdmin();
  if (!admin) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: scales, error: scaleErr } = await admin
    .from("grade_scales")
    .select("id, name, scope, is_default, created_at, updated_at")
    .order("scope", { ascending: true })
    .order("is_default", { ascending: false })
    .order("name", { ascending: true });

  if (scaleErr) {
    console.error("[grade-scales.GET] list:", scaleErr);
    return NextResponse.json({ error: "Failed to load grade scales" }, { status: 500 });
  }

  const scaleIds = (scales ?? []).map((s) => s.id);
  const { data: bands } =
    scaleIds.length > 0
      ? await admin
          .from("grade_bands")
          .select("id, grade_scale_id, label, min_pct, max_pct, remark, sort_order")
          .in("grade_scale_id", scaleIds)
          .order("sort_order", { ascending: true })
      : { data: [] };

  const { data: assignments } = await admin
    .from("class_grade_scales")
    .select("class_id, grade_scale_id");

  const bandsByScale = new Map<string, typeof bands>();
  for (const b of bands ?? []) {
    const arr = bandsByScale.get(b.grade_scale_id) ?? [];
    arr.push(b);
    bandsByScale.set(b.grade_scale_id, arr);
  }

  const classIdsByScale = new Map<string, string[]>();
  for (const a of assignments ?? []) {
    const arr = classIdsByScale.get(a.grade_scale_id) ?? [];
    arr.push(a.class_id);
    classIdsByScale.set(a.grade_scale_id, arr);
  }

  const enriched = (scales ?? []).map((s) => ({
    ...s,
    bands: bandsByScale.get(s.id) ?? [],
    assigned_class_ids: classIdsByScale.get(s.id) ?? [],
  }));

  return NextResponse.json({ data: enriched });
}

export async function POST(request: NextRequest) {
  const admin = await verifyAdmin();
  if (!admin) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid data", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const { name, scope, is_default, bands } = parsed.data;

  // If this one is flagged default, unset the current default for its scope
  // first — partial unique index enforces one default per scope.
  if (is_default) {
    await admin
      .from("grade_scales")
      .update({ is_default: false })
      .eq("scope", scope)
      .eq("is_default", true);
  }

  const { data: scale, error: scaleErr } = await admin
    .from("grade_scales")
    .insert({ name, scope, is_default })
    .select("id, name, scope, is_default")
    .single();

  if (scaleErr || !scale) {
    console.error("[grade-scales.POST] insert scale:", scaleErr);
    return NextResponse.json(
      { error: "Failed to create grade scale" },
      { status: 500 }
    );
  }

  const bandRows = bands.map((b, idx) => ({
    grade_scale_id: scale.id,
    label: b.label,
    min_pct: b.min_pct,
    max_pct: b.max_pct,
    remark: b.remark ?? null,
    sort_order: b.sort_order ?? idx,
  }));

  const { error: bandErr } = await admin.from("grade_bands").insert(bandRows);
  if (bandErr) {
    console.error("[grade-scales.POST] insert bands:", bandErr);
    // Roll back the scale so we don't leave a bandless scale row behind.
    await admin.from("grade_scales").delete().eq("id", scale.id);
    return NextResponse.json({ error: "Failed to create grade bands" }, { status: 500 });
  }

  return NextResponse.json({ data: { ...scale, bands: bandRows } });
}
