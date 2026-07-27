import { NextRequest, NextResponse } from "next/server";
import { verifyAdminOrEditorWithUser } from "@nkps/shared/lib/verify-admin";
import { applyTransportChange, isPermanentChange } from "@/lib/transport";

interface RouteContext {
  params: Promise<{ id: string }>;
}

// PATCH /api/transport/changes/[id]
// Review a pending change request: approve (applies it) / reject / cancel.
// Body: { action: 'approve' | 'reject' | 'cancel', review_note?: string }
export async function PATCH(request: NextRequest, context: RouteContext) {
  const auth = await verifyAdminOrEditorWithUser("transport");
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { admin, user } = auth;
  const { id } = await context.params;

  const body = await request.json().catch(() => ({}));
  const action = body?.action as string | undefined;
  const reviewNote = (body?.review_note as string | undefined) ?? null;
  if (!action || !["approve", "reject", "cancel"].includes(action)) {
    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  }

  const { data: change, error: loadError } = await admin
    .from("transport_change_requests")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (loadError || !change) {
    return NextResponse.json({ error: "Change not found" }, { status: 404 });
  }
  if (change.status !== "pending") {
    return NextResponse.json(
      { error: `Change is already ${change.status}` },
      { status: 409 }
    );
  }

  if (action === "reject" || action === "cancel") {
    const { data: updated } = await admin
      .from("transport_change_requests")
      .update({
        status: action === "reject" ? "rejected" : "cancelled",
        reviewed_by: user.id,
        reviewed_at: new Date().toISOString(),
        review_note: reviewNote,
      })
      .eq("id", id)
      .select()
      .single();
    return NextResponse.json({ success: true, change: updated });
  }

  // approve — guard one-side without a custom fee (would trip the DB check).
  if (
    change.change_type === "direction_change" &&
    change.direction &&
    change.direction !== "both"
  ) {
    const { data: enrollment } = await admin
      .from("student_enrollments")
      .select("transport_fee_override")
      .eq("id", change.enrollment_id)
      .maybeSingle();
    if (!enrollment || enrollment.transport_fee_override == null) {
      return NextResponse.json(
        {
          error:
            "Set the one-side custom fee on the Student Assignments page before approving this change.",
        },
        { status: 400 }
      );
    }
  }

  const applyResult = await applyTransportChange(admin, change);
  if (applyResult.error) {
    return NextResponse.json({ error: applyResult.error }, { status: 400 });
  }

  const newStatus =
    isPermanentChange(change) ||
    change.change_type === "drop" ||
    change.change_type === "resume"
      ? "applied"
      : "approved";

  const { data: updated } = await admin
    .from("transport_change_requests")
    .update({
      status: newStatus,
      reviewed_by: user.id,
      reviewed_at: new Date().toISOString(),
      review_note: reviewNote,
    })
    .eq("id", id)
    .select()
    .single();

  return NextResponse.json({ success: true, change: updated });
}
