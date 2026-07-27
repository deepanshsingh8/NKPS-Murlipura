import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { createAdminClient } from "@nkps/shared/lib/supabase/admin";
import { transportChangeRequestSchema } from "@nkps/shared/lib/validations";

const APPLICATIONS_BUCKET = "transport-applications";
const MAX_BYTES = 10 * 1024 * 1024;
const ALLOWED = new Set(["application/pdf", "image/jpeg", "image/png"]);

// POST /api/portal/transport/change-request
// A parent submits a transport change application for their own child. The
// request lands as source='parent', status='pending' for the office to review.
// direction_change (one-side) is school-only and is rejected here.
export async function POST(request: NextRequest) {
  try {
    const headersList = await headers();
    const authHeader = headersList.get("authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const accessToken = authHeader.slice(7);
    const admin = createAdminClient();

    const {
      data: { user },
      error: authError,
    } = await admin.auth.getUser(accessToken);
    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { data: profile } = await admin
      .from("profiles")
      .select("role, parent_id, must_change_password")
      .eq("id", user.id)
      .single();
    if (!profile || profile.must_change_password || profile.role !== "parent" || !profile.parent_id) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const formData = await request.formData();
    const payload = {
      enrollment_id: String(formData.get("enrollment_id") ?? ""),
      change_type: String(formData.get("change_type") ?? ""),
      amended_bus_id: (formData.get("amended_bus_id") as string) || undefined,
      amended_stop_id: (formData.get("amended_stop_id") as string) || undefined,
      effective_from: String(formData.get("effective_from") ?? ""),
      effective_to: (formData.get("effective_to") as string) || undefined,
      reason_code: String(formData.get("reason_code") ?? ""),
      reason_note: (formData.get("reason_note") as string) || undefined,
    };

    const parsed = transportChangeRequestSchema.safeParse(payload);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid data", details: parsed.error.flatten() },
        { status: 400 }
      );
    }
    const d = parsed.data;

    // One-side facility is school-only.
    if (d.change_type === "direction_change") {
      return NextResponse.json(
        { error: "One-side facility changes are handled by the school office." },
        { status: 403 }
      );
    }

    // Ownership: the enrollment's student must be linked to this parent.
    const { data: enrollment } = await admin
      .from("student_enrollments")
      .select("id, student_id, bus_id, bus_stop_id")
      .eq("id", d.enrollment_id)
      .maybeSingle();
    if (!enrollment) {
      return NextResponse.json({ error: "Enrollment not found" }, { status: 404 });
    }
    const { data: link } = await admin
      .from("student_parents")
      .select("student_id")
      .eq("parent_id", profile.parent_id)
      .eq("student_id", enrollment.student_id)
      .maybeSingle();
    if (!link) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // Optional application upload.
    let applicationPath: string | null = null;
    const file = formData.get("file") as File | null;
    if (file && file.size > 0) {
      if (file.size > MAX_BYTES) {
        return NextResponse.json({ error: "File must be under 10 MB" }, { status: 413 });
      }
      if (!ALLOWED.has(file.type)) {
        return NextResponse.json(
          { error: "Only PDF, JPEG, or PNG files are allowed" },
          { status: 415 }
        );
      }
      const ext = file.type === "application/pdf" ? "pdf" : file.type === "image/png" ? "png" : "jpg";
      const path = `${enrollment.student_id}/${Date.now()}.${ext}`;
      const { error: uploadError } = await admin.storage
        .from(APPLICATIONS_BUCKET)
        .upload(path, file, { contentType: file.type, upsert: false });
      if (uploadError) {
        console.error("Application upload error:", uploadError);
        return NextResponse.json({ error: "Failed to upload application" }, { status: 500 });
      }
      applicationPath = path;
    }

    const { data: created, error: insertError } = await admin
      .from("transport_change_requests")
      .insert({
        enrollment_id: d.enrollment_id,
        change_type: d.change_type,
        previous_bus_id: enrollment.bus_id,
        amended_bus_id: d.amended_bus_id ?? null,
        previous_stop_id: enrollment.bus_stop_id,
        amended_stop_id: d.amended_stop_id ?? null,
        direction: null,
        effective_from: d.effective_from,
        effective_to: d.effective_to || null,
        reason_code: d.reason_code,
        reason_note: d.reason_note ?? null,
        application_url: applicationPath,
        source: "parent",
        status: "pending",
        requested_by: user.id,
      })
      .select()
      .single();

    if (insertError || !created) {
      console.error("Parent change insert error:", insertError);
      return NextResponse.json({ error: "Failed to submit request" }, { status: 500 });
    }

    return NextResponse.json({ success: true, change: created });
  } catch (err) {
    console.error("[Transport change request error]", err);
    return NextResponse.json({ error: "Submission failed" }, { status: 500 });
  }
}
