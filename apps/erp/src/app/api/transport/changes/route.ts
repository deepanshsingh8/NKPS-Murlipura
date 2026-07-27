import { NextResponse } from "next/server";
import { verifyAdminOrEditorWithUser } from "@nkps/shared/lib/verify-admin";
import { transportChangeRequestSchema } from "@nkps/shared/lib/validations";
import { applyTransportChange, isPermanentChange } from "@/lib/transport";

const APPLICATIONS_BUCKET = "transport-applications";

// GET /api/transport/changes?status=pending
// Lists change requests with resolved student / bus / stop labels and a
// short-lived signed URL for any uploaded application.
export async function GET(request: Request) {
  const auth = await verifyAdminOrEditorWithUser("transport");
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { admin } = auth;

  const { searchParams } = new URL(request.url);
  const status = searchParams.get("status");

  let query = admin
    .from("transport_change_requests")
    .select(
      "*, enrollment:student_enrollments(id, student_id, students(full_name, admission_no)), " +
        "previous_bus:buses!transport_change_requests_previous_bus_id_fkey(bus_number), " +
        "amended_bus:buses!transport_change_requests_amended_bus_id_fkey(bus_number), " +
        "previous_stop:bus_stops!transport_change_requests_previous_stop_id_fkey(name), " +
        "amended_stop:bus_stops!transport_change_requests_amended_stop_id_fkey(name)"
    )
    .order("created_at", { ascending: false });

  if (status) query = query.eq("status", status);

  const { data, error } = await query;
  if (error) {
    console.error("List transport changes error:", error);
    return NextResponse.json({ error: "Failed to load changes" }, { status: 500 });
  }

  // Sign application paths so the office can open them without a public bucket.
  const rows = await Promise.all(
    (((data ?? []) as unknown) as Array<Record<string, unknown>>).map(async (row) => {
      let applicationSignedUrl: string | null = null;
      if (row.application_url) {
        const { data: signed } = await admin.storage
          .from(APPLICATIONS_BUCKET)
          .createSignedUrl(row.application_url as string, 60 * 10);
        applicationSignedUrl = signed?.signedUrl ?? null;
      }
      return { ...row, applicationSignedUrl };
    })
  );

  return NextResponse.json({ changes: rows });
}

// POST /api/transport/changes — office-created change. The office is
// authoritative, so the change is created AND applied immediately (permanent
// changes update the enrollment baseline; temporary ones become an overlay).
export async function POST(request: Request) {
  const auth = await verifyAdminOrEditorWithUser("transport");
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { admin, user } = auth;

  const body = await request.json();
  const parsed = transportChangeRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid data", details: parsed.error.flatten() },
      { status: 400 }
    );
  }
  const d = parsed.data;

  // Snapshot the current assignment as the "previous" for auditability.
  const { data: enrollment } = await admin
    .from("student_enrollments")
    .select("id, bus_id, bus_stop_id, transport_direction, transport_fee_override")
    .eq("id", d.enrollment_id)
    .maybeSingle();
  if (!enrollment) {
    return NextResponse.json({ error: "Enrollment not found" }, { status: 400 });
  }

  // One-side switch needs a custom fee already on the enrollment (set on the
  // Assignments page) — otherwise the DB check would reject the baseline write.
  if (
    d.change_type === "direction_change" &&
    d.direction &&
    d.direction !== "both" &&
    enrollment.transport_fee_override == null
  ) {
    return NextResponse.json(
      {
        error:
          "Set the one-side custom fee on the Student Assignments page before recording this change.",
      },
      { status: 400 }
    );
  }

  const permanent = isPermanentChange(d);
  const insertRow = {
    enrollment_id: d.enrollment_id,
    change_type: d.change_type,
    previous_bus_id: enrollment.bus_id,
    amended_bus_id: d.amended_bus_id ?? null,
    previous_stop_id: enrollment.bus_stop_id,
    amended_stop_id: d.amended_stop_id ?? null,
    direction: d.direction ?? null,
    effective_from: d.effective_from,
    effective_to: d.effective_to || null,
    reason_code: d.reason_code,
    reason_note: d.reason_note ?? null,
    application_url: d.application_url ?? null,
    source: "office",
    status: "pending",
    requested_by: user.id,
  };

  const { data: created, error: insertError } = await admin
    .from("transport_change_requests")
    .insert(insertRow)
    .select()
    .single();
  if (insertError || !created) {
    console.error("Create transport change error:", insertError);
    return NextResponse.json({ error: "Failed to create change" }, { status: 500 });
  }

  // Apply immediately.
  const applyResult = await applyTransportChange(admin, created);
  if (applyResult.error) {
    return NextResponse.json({ error: applyResult.error }, { status: 400 });
  }

  const newStatus =
    permanent ||
    created.change_type === "drop" ||
    created.change_type === "resume"
      ? "applied"
      : "approved";

  const { data: finalRow } = await admin
    .from("transport_change_requests")
    .update({
      status: newStatus,
      reviewed_by: user.id,
      reviewed_at: new Date().toISOString(),
    })
    .eq("id", created.id)
    .select()
    .single();

  return NextResponse.json({ success: true, change: finalRow ?? created });
}
