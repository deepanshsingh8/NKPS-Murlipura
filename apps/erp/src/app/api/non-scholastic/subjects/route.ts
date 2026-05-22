import { NextRequest, NextResponse } from "next/server";
import { verifyAdmin } from "@nkps/shared/lib/verify-admin";
import { z } from "zod";

const subjectSchema = z.object({
  name: z.string().min(1, "Name required"),
  sort_order: z.number().int().min(0).optional(),
  is_active: z.boolean().optional(),
});

export async function GET() {
  const admin = await verifyAdmin();
  if (!admin) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { data: subjects, error } = await admin
    .from("non_scholastic_subjects")
    .select("id, name, sort_order, is_active, created_at, updated_at")
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true });

  if (error) {
    console.error("[non-scholastic.subjects.GET] list:", error);
    return NextResponse.json({ error: "Failed to load non-scholastic subjects" }, { status: 500 });
  }

  // Attach sub_subject counts so the admin UI can show "N sub-subjects" per row.
  const ids = (subjects ?? []).map((s) => s.id);
  const counts = new Map<string, number>();
  if (ids.length > 0) {
    const { data: subSubjects } = await admin
      .from("non_scholastic_sub_subjects")
      .select("parent_subject_id")
      .in("parent_subject_id", ids);
    for (const row of subSubjects ?? []) {
      const key = row.parent_subject_id as string;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }

  return NextResponse.json({
    data: (subjects ?? []).map((s) => ({
      ...s,
      sub_subject_count: counts.get(s.id) ?? 0,
    })),
  });
}

export async function POST(request: NextRequest) {
  const admin = await verifyAdmin();
  if (!admin) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const body = await request.json();
  const parsed = subjectSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid data", details: parsed.error.flatten() },
      { status: 400 }
    );
  }
  const { data, error } = await admin
    .from("non_scholastic_subjects")
    .insert({
      name: parsed.data.name.trim(),
      sort_order: parsed.data.sort_order ?? 0,
      is_active: parsed.data.is_active ?? true,
    })
    .select("id, name, sort_order, is_active")
    .single();
  if (error) {
    console.error("[non-scholastic.subjects.POST] insert:", error);
    return NextResponse.json({ error: "Failed to create non-scholastic subject" }, { status: 500 });
  }
  return NextResponse.json({ data });
}
