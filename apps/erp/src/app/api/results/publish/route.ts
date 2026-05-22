import { NextResponse } from "next/server";
import { verifyAdminOrEditorWithUser } from "@nkps/shared/lib/verify-admin";
import { publishResultsSchema } from "@nkps/shared/lib/validations";

// POST /api/results/publish
// Body: { class_id, exam_type_id, is_published }
// Bulk-toggles `results.is_published` for the given class+exam scope.
// Logs a publish_events row. Admin (or editor with publish_results) only.
export async function POST(request: Request) {
  const auth = await verifyAdminOrEditorWithUser("publish_results");
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { admin, user } = auth;

  const body = await request.json();
  const parsed = publishResultsSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid data", details: parsed.error.flatten() },
      { status: 400 }
    );
  }
  const { class_id, exam_type_id, is_published } = parsed.data;

  const { data: updated, error } = await admin
    .from("results")
    .update({ is_published, updated_at: new Date().toISOString() })
    .eq("class_id", class_id)
    .eq("exam_type_id", exam_type_id)
    .select("id");
  if (error) {
    console.error("[results.publish.POST] update:", error);
    return NextResponse.json(
      { error: "Failed to update publish state" },
      { status: 500 }
    );
  }
  const affected = updated?.length ?? 0;

  await admin.from("publish_events").insert({
    event_type: is_published ? "publish_results" : "unpublish_results",
    class_id,
    exam_type_id,
    actor_id: user.id,
    note: `Affected ${affected} result rows`,
  });

  return NextResponse.json({ success: true, affected, is_published });
}

// GET /api/results/publish?class_id=&exam_type_id=
// Returns the current publish state for a (class, exam) pair:
// total results rows + count published. Used by the admin page to render
// the status ("N of M results published").
export async function GET(request: Request) {
  const auth = await verifyAdminOrEditorWithUser("publish_results");
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const url = new URL(request.url);
  const classId = url.searchParams.get("class_id");
  const examTypeId = url.searchParams.get("exam_type_id");
  if (!classId || !examTypeId) {
    return NextResponse.json(
      { error: "class_id and exam_type_id required" },
      { status: 400 }
    );
  }

  const { admin } = auth;
  const { data } = await admin
    .from("results")
    .select("id, is_published")
    .eq("class_id", classId)
    .eq("exam_type_id", examTypeId);
  const total = data?.length ?? 0;
  const published = (data ?? []).filter((r) => r.is_published).length;

  return NextResponse.json({ total, published });
}
