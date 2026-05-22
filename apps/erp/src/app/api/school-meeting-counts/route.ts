import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@nkps/shared/lib/supabase/server";
import { schoolMeetingCountSchema } from "@nkps/shared/lib/validations";

// GET /api/school-meeting-counts?academic_year_id=&exam_type_id=&class_id=
// Any combination of scope filters; NULL-scope rows are included when
// exam_type_id / class_id are absent from the query. Authenticated read only.
export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const params = request.nextUrl.searchParams;
  const yearId = params.get("academic_year_id");
  if (!yearId) {
    return NextResponse.json(
      { error: "academic_year_id is required" },
      { status: 400 }
    );
  }
  const examTypeId = params.get("exam_type_id");
  const classId = params.get("class_id");

  let query = supabase
    .from("school_meeting_counts")
    .select("id, academic_year_id, exam_type_id, class_id, total_meetings, updated_at")
    .eq("academic_year_id", yearId);

  // Interpret "null" literal string and missing param the same way: match
  // NULL-scope rows explicitly when asked, otherwise include everything.
  if (examTypeId === "null") query = query.is("exam_type_id", null);
  else if (examTypeId) query = query.eq("exam_type_id", examTypeId);

  if (classId === "null") query = query.is("class_id", null);
  else if (classId) query = query.eq("class_id", classId);

  const { data, error } = await query;
  if (error) {
    console.error("[school-meeting-counts.GET] list:", error);
    return NextResponse.json({ error: "Failed to load school meeting counts" }, { status: 500 });
  }
  return NextResponse.json({ data: data ?? [] });
}

// PUT /api/school-meeting-counts — upsert on (year, exam_type, class).
// Uses an expression-based unique index in the DB; we replicate the upsert
// key resolution here because Supabase's onConflict can't target expression
// indexes.
export async function PUT(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();
  if (!profile) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (profile.role !== "admin" && profile.role !== "teacher") {
    const { data: perm } = await supabase
      .from("editor_permissions")
      .select("feature_key")
      .eq("editor_id", user.id)
      .eq("feature_key", "ptm_notes")
      .maybeSingle();
    if (!perm) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
  }

  const body = await request.json();
  const parsed = schoolMeetingCountSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid data", details: parsed.error.flatten() },
      { status: 400 }
    );
  }
  const { academic_year_id, exam_type_id, class_id, total_meetings } =
    parsed.data;

  // Find existing row (can't use onConflict on an expression index, so
  // do a read-then-write).
  let findQuery = supabase
    .from("school_meeting_counts")
    .select("id")
    .eq("academic_year_id", academic_year_id);
  findQuery = exam_type_id
    ? findQuery.eq("exam_type_id", exam_type_id)
    : findQuery.is("exam_type_id", null);
  findQuery = class_id
    ? findQuery.eq("class_id", class_id)
    : findQuery.is("class_id", null);

  const { data: existing } = await findQuery.maybeSingle();

  if (existing?.id) {
    const { data, error } = await supabase
      .from("school_meeting_counts")
      .update({ total_meetings })
      .eq("id", existing.id)
      .select()
      .single();
    if (error) {
      console.error("[school-meeting-counts.PUT] update:", error);
      return NextResponse.json({ error: "Failed to update school meeting count" }, { status: 500 });
    }
    return NextResponse.json({ data });
  }

  const { data, error } = await supabase
    .from("school_meeting_counts")
    .insert({
      academic_year_id,
      exam_type_id: exam_type_id ?? null,
      class_id: class_id ?? null,
      total_meetings,
    })
    .select()
    .single();
  if (error) {
    console.error("[school-meeting-counts.PUT] insert:", error);
    return NextResponse.json({ error: "Failed to create school meeting count" }, { status: 500 });
  }
  return NextResponse.json({ data }, { status: 201 });
}
