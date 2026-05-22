import { NextResponse } from "next/server";
import { verifyAdminOrEditorWithUser } from "@nkps/shared/lib/verify-admin";
import {
  finalizeYearFinalSchema,
  unpublishMarksheetSchema,
} from "@nkps/shared/lib/validations";
import { buildYearFinalSnapshot } from "@/lib/marksheet-snapshot";

// POST /api/results/finalize-year-final
// Body: { class_id, academic_year_id, student_ids?, unpublish_reason_on_refinalize? }
//
// Snapshots the year-end final-result aggregate for each target student. Use
// this once the year is closed and you want to freeze report cards (the per-
// exam finalize-marksheet endpoint is for the older Mid-term / Half-yearly
// flow). Atomic per student via the `finalize_year_final_one` RPC.
export async function POST(request: Request) {
  const auth = await verifyAdminOrEditorWithUser("publish_results");
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { admin, user } = auth;

  const body = await request.json();
  const parsed = finalizeYearFinalSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid data", details: parsed.error.flatten() },
      { status: 400 }
    );
  }
  const {
    class_id,
    academic_year_id,
    student_ids,
    unpublish_reason_on_refinalize,
  } = parsed.data;

  // Resolve target students from the class's active enrollments for this year.
  const { data: enrollments, error: enrErr } = await admin
    .from("student_enrollments")
    .select("student_id")
    .eq("class_id", class_id)
    .eq("academic_year_id", academic_year_id)
    .eq("status", "active");
  if (enrErr) {
    console.error("[finalize-year-final] enrollment fetch:", enrErr);
    return NextResponse.json(
      { error: "Failed to load enrollments" },
      { status: 500 }
    );
  }
  const activeSet = new Set((enrollments ?? []).map((e) => e.student_id as string));
  const targetStudents =
    student_ids && student_ids.length > 0
      ? student_ids.filter((id) => activeSet.has(id))
      : Array.from(activeSet);

  if (targetStudents.length === 0) {
    return NextResponse.json(
      { error: "No active students in scope" },
      { status: 400 }
    );
  }

  // Same up-front re-finalize check as the per-exam route — force the caller
  // to supply a reason when any target student has a live year-final row.
  const { data: priorActive } = await admin
    .from("marksheet_publications")
    .select("student_id")
    .eq("class_id", class_id)
    .eq("academic_year_id", academic_year_id)
    .eq("kind", "year_final")
    .in("student_id", targetStudents)
    .is("unpublished_at", null);
  const hasPriorActive = (priorActive?.length ?? 0) > 0;
  if (hasPriorActive && !unpublish_reason_on_refinalize) {
    return NextResponse.json(
      {
        error:
          "Re-finalize requires a reason. Pass unpublish_reason_on_refinalize describing why the prior year-final marksheets are being replaced.",
        prior_active_count: priorActive?.length ?? 0,
      },
      { status: 400 }
    );
  }
  const refinalizeReason = unpublish_reason_on_refinalize ?? "re-finalized";

  let finalized = 0;
  let refinalized = 0;
  let skipped = 0;
  const errors: Array<{ student_id: string; error: string }> = [];

  for (const studentId of targetStudents) {
    try {
      const snapshot = await buildYearFinalSnapshot(
        admin,
        studentId,
        academic_year_id
      );
      if (!snapshot) {
        skipped++;
        continue;
      }

      const { data: rpcResult, error: rpcErr } = await admin.rpc(
        "finalize_year_final_one",
        {
          p_student_id: studentId,
          p_class_id: class_id,
          p_academic_year_id: academic_year_id,
          p_snapshot: snapshot,
          p_schema_version: snapshot.schema_version,
          p_published_by: user.id,
          p_unpublish_reason: refinalizeReason,
        }
      );
      if (rpcErr) {
        errors.push({ student_id: studentId, error: "Failed to finalize" });
        console.error(
          `[finalize-year-final] rpc error student=${studentId}:`,
          rpcErr
        );
        continue;
      }
      const result = (rpcResult as { refinalized?: boolean } | null) ?? null;
      if (result?.refinalized) refinalized++;
      finalized++;
    } catch (err) {
      errors.push({
        student_id: studentId,
        error: err instanceof Error ? err.message : "Unknown error",
      });
    }
  }

  await admin.from("publish_events").insert({
    event_type:
      refinalized > 0 ? "re_finalize_year_final" : "finalize_year_final",
    class_id,
    actor_id: user.id,
    note: `Year-final: ${finalized} (${refinalized} re-finalized, ${skipped} skipped, ${errors.length} errors)`,
  });

  return NextResponse.json({
    success: true,
    finalized,
    refinalized,
    skipped,
    errors,
  });
}

// DELETE — unpublish active year-final rows for a class/year (optionally
// scoped to specific students). Reason required, same as the per-exam route.
export async function DELETE(request: Request) {
  const auth = await verifyAdminOrEditorWithUser("publish_results");
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { admin, user } = auth;

  const body = await request.json();
  // Borrow the existing unpublishMarksheetSchema but read academic_year_id
  // out of the (older) `exam_type_id` slot is wrong — we use a parallel,
  // stricter schema here.
  const parsed = unpublishMarksheetSchema
    .pick({ class_id: true, unpublish_reason: true, student_ids: true })
    .extend({
      academic_year_id: finalizeYearFinalSchema.shape.academic_year_id,
    })
    .safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid data", details: parsed.error.flatten() },
      { status: 400 }
    );
  }
  const { class_id, academic_year_id, unpublish_reason, student_ids } =
    parsed.data;

  let q = admin
    .from("marksheet_publications")
    .update({
      unpublished_at: new Date().toISOString(),
      unpublish_reason,
      unpublished_by: user.id,
    })
    .eq("class_id", class_id)
    .eq("academic_year_id", academic_year_id)
    .eq("kind", "year_final")
    .is("unpublished_at", null);
  if (student_ids && student_ids.length > 0) {
    q = q.in("student_id", student_ids);
  }
  const { data, error } = await q.select("id");
  if (error) {
    console.error("[finalize-year-final] unpublish error:", error);
    return NextResponse.json(
      { error: "Failed to unpublish" },
      { status: 500 }
    );
  }
  const affected = data?.length ?? 0;

  await admin.from("publish_events").insert({
    event_type: "unpublish_year_final",
    class_id,
    actor_id: user.id,
    note: `Unpublished ${affected} year-final marksheets · reason: ${unpublish_reason}`,
  });

  return NextResponse.json({ success: true, affected });
}
