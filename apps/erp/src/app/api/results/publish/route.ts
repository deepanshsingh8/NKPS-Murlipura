import { NextResponse } from "next/server";
import { verifyAdminOrEditorWithUser } from "@nkps/shared/lib/verify-admin";
import { publishResultsSchema } from "@nkps/shared/lib/validations";

// POST /api/results/publish
// Body: { class_id, exam_type_id, is_published }
// Bulk-toggles `results.is_published` AND
// `non_scholastic_assessments.is_published` for the given class+exam scope.
// Logs a publish_events row. Admin (or editor with publish_results) only.
//
// Co-scholastic grades ride on this one action deliberately: they are printed
// on the same report card, they carry the same (class_id, exam_type_id) scope,
// and a second "publish co-scholastic" button is a button nobody presses —
// which is exactly how these grades ended up permanently invisible.
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

  // Same scope, same flip. The report card filters co-scholastic rows on
  // `is_published` too, so leaving them behind here is what made teacher-entered
  // grades silently never print.
  const { data: nsUpdated, error: nsError } = await admin
    .from("non_scholastic_assessments")
    .update({ is_published, updated_at: new Date().toISOString() })
    .eq("class_id", class_id)
    .eq("exam_type_id", exam_type_id)
    .select("id");
  if (nsError) {
    console.error("[results.publish.POST] non-scholastic update:", nsError);
    // The results flip already landed. Both updates are idempotent (setting
    // is_published to the value it already holds is a no-op), so surfacing the
    // failure and letting the admin press the button again is safe and leaves
    // no half-published state to reason about.
    return NextResponse.json(
      {
        error:
          "Results updated, but co-scholastic grades failed. Press the button again.",
      },
      { status: 500 }
    );
  }
  const nonScholasticAffected = nsUpdated?.length ?? 0;

  // Reuses the existing `publish_results` / `unpublish_results` event types —
  // this IS that event, now covering both row sets. No new CHECK value, so no
  // migration; the note carries the breakdown.
  await admin.from("publish_events").insert({
    event_type: is_published ? "publish_results" : "unpublish_results",
    class_id,
    exam_type_id,
    actor_id: user.id,
    note: `Affected ${affected} result rows, ${nonScholasticAffected} co-scholastic rows`,
  });

  return NextResponse.json({
    success: true,
    affected,
    non_scholastic_affected: nonScholasticAffected,
    is_published,
  });
}

// GET /api/results/publish?class_id=&exam_type_id=
// Returns the current publish state for a (class, exam) pair: total rows +
// count published, for results and co-scholastic assessments separately.
// Used by the admin page to render the status ("N of M results published").
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
  const [{ data }, { data: nsData }] = await Promise.all([
    admin
      .from("results")
      .select("id, is_published")
      .eq("class_id", classId)
      .eq("exam_type_id", examTypeId),
    admin
      .from("non_scholastic_assessments")
      .select("id, is_published")
      .eq("class_id", classId)
      .eq("exam_type_id", examTypeId),
  ]);
  const total = data?.length ?? 0;
  const published = (data ?? []).filter((r) => r.is_published).length;

  return NextResponse.json({
    total,
    published,
    non_scholastic_total: nsData?.length ?? 0,
    non_scholastic_published: (nsData ?? []).filter((r) => r.is_published).length,
  });
}
