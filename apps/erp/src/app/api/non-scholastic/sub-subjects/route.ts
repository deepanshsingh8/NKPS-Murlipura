import { NextRequest, NextResponse } from "next/server";
import { verifyAdmin } from "@nkps/shared/lib/verify-admin";
import { z } from "zod";

const subSubjectSchema = z.object({
  parent_subject_id: z.string().uuid(),
  name: z.string().min(1, "Name required"),
  grade_scale_id: z.string().uuid().nullable().optional(),
  sort_order: z.number().int().min(0).optional(),
  is_active: z.boolean().optional(),
  // Optional class scoping. Empty/absent = available to every class (default).
  // A non-empty array restricts the sub-subject to those classes only.
  class_ids: z.array(z.string().uuid()).optional(),
});

export async function GET(request: NextRequest) {
  const admin = await verifyAdmin();
  if (!admin) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const parentId = request.nextUrl.searchParams.get("parent_subject_id");
  // When `class_id` is supplied, return only sub-subjects available to that
  // class — i.e. either un-scoped (no rows in the join table) OR explicitly
  // linked to this class. Used by the teacher entry grid + assessment forms.
  const classId = request.nextUrl.searchParams.get("class_id");

  let query = admin
    .from("non_scholastic_sub_subjects")
    .select(
      "id, parent_subject_id, name, grade_scale_id, sort_order, is_active, created_at"
    )
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true });

  if (parentId) {
    query = query.eq("parent_subject_id", parentId);
  }

  const { data, error } = await query;
  if (error) {
    console.error("[non-scholastic.sub-subjects.GET] list:", error);
    return NextResponse.json({ error: "Failed to load sub-subjects" }, { status: 500 });
  }

  let rows = data ?? [];

  // L13 — single fetch of class-link rows, partitioned in JS for both the
  // class_id filter and the per-row class_ids attachment. Previously we
  // queried the join table twice when class_id was supplied.
  const classIdsBySub = new Map<string, string[]>();
  if (rows.length > 0) {
    const { data: linkRows } = await admin
      .from("non_scholastic_sub_subject_classes")
      .select("sub_subject_id, class_id")
      .in(
        "sub_subject_id",
        rows.map((r) => r.id as string)
      );
    for (const r of linkRows ?? []) {
      const sid = r.sub_subject_id as string;
      const arr = classIdsBySub.get(sid) ?? [];
      arr.push(r.class_id as string);
      classIdsBySub.set(sid, arr);
    }

    if (classId) {
      // sub_subject is shown when it's either un-scoped (no link rows) or
      // has an explicit link to the requested class.
      rows = rows.filter((r) => {
        const links = classIdsBySub.get(r.id as string);
        return !links || links.length === 0 || links.includes(classId);
      });
    }
  }

  const enriched = rows.map((r) => ({
    ...r,
    class_ids: classIdsBySub.get(r.id as string) ?? [],
  }));

  return NextResponse.json({ data: enriched });
}

export async function POST(request: NextRequest) {
  const admin = await verifyAdmin();
  if (!admin) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const body = await request.json();
  const parsed = subSubjectSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid data", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  // Guard: if grade_scale_id supplied, ensure it belongs to the non_scholastic scope.
  if (parsed.data.grade_scale_id) {
    const { data: scale } = await admin
      .from("grade_scales")
      .select("scope")
      .eq("id", parsed.data.grade_scale_id)
      .maybeSingle();
    if (!scale || scale.scope !== "non_scholastic") {
      return NextResponse.json(
        { error: "grade_scale_id must reference a non-scholastic scale" },
        { status: 400 }
      );
    }
  }

  const { data, error } = await admin
    .from("non_scholastic_sub_subjects")
    .insert({
      parent_subject_id: parsed.data.parent_subject_id,
      name: parsed.data.name.trim(),
      grade_scale_id: parsed.data.grade_scale_id ?? null,
      sort_order: parsed.data.sort_order ?? 0,
      is_active: parsed.data.is_active ?? true,
    })
    .select("id, parent_subject_id, name, grade_scale_id, sort_order, is_active")
    .single();
  if (error) {
    console.error("[non-scholastic.sub-subjects.POST] insert:", error);
    return NextResponse.json({ error: "Failed to create sub-subject" }, { status: 500 });
  }

  // Class scoping is opt-in: only insert join rows when the caller passed a
  // non-empty array. Skip silently when omitted (empty = global).
  const classIds = parsed.data.class_ids ?? [];
  if (classIds.length > 0) {
    const { error: linkErr } = await admin
      .from("non_scholastic_sub_subject_classes")
      .insert(
        classIds.map((class_id) => ({
          sub_subject_id: data.id as string,
          class_id,
        }))
      );
    if (linkErr) {
      console.error("[non-scholastic.sub-subjects.POST] class links:", linkErr);
      // Non-fatal; the sub-subject is created and the admin can edit class
      // scoping on the next save.
    }
  }
  return NextResponse.json({
    data: { ...data, class_ids: classIds },
  });
}
