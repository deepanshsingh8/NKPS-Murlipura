import { NextResponse } from "next/server";
import { createAdminClient } from "@nkps/shared/lib/supabase/admin";
import { createClient } from "@nkps/shared/lib/supabase/server";
import { sendEmail, buildRegistrationRejectedEmail } from "@nkps/shared/lib/email";

export async function POST(request: Request) {
  try {
    // Verify the caller is an admin
    const serverSupabase = await createClient();
    const {
      data: { user },
    } = await serverSupabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { data: callerProfile } = await serverSupabase
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .single();

    if (!callerProfile || callerProfile.role !== "admin") {
      return NextResponse.json(
        { error: "Forbidden: admin access required" },
        { status: 403 }
      );
    }

    const { id, reason } = await request.json();
    if (!id) {
      return NextResponse.json(
        { error: "Registration request ID is required" },
        { status: 400 }
      );
    }

    const supabase = createAdminClient();

    // Fetch the registration request
    const { data: registration, error: fetchError } = await supabase
      .from("registration_requests")
      .select("*")
      .eq("id", id)
      .single();

    if (fetchError || !registration) {
      return NextResponse.json(
        { error: "Registration request not found" },
        { status: 404 }
      );
    }

    if (registration.status !== "pending") {
      return NextResponse.json(
        { error: `This request has already been ${registration.status}` },
        { status: 400 }
      );
    }

    // Update registration request status
    const { error: updateError } = await supabase
      .from("registration_requests")
      .update({
        status: "rejected",
        rejection_reason: reason || null,
        reviewed_by: user.id,
        reviewed_at: new Date().toISOString(),
      })
      .eq("id", id);

    if (updateError) {
      console.error("Reject registration error:", updateError);
      return NextResponse.json(
        { error: "Failed to reject registration" },
        { status: 500 }
      );
    }

    // Send rejection email (non-blocking)
    try {
      const html = buildRegistrationRejectedEmail({
        fullName: registration.full_name,
        reason: reason || undefined,
      });
      await sendEmail(registration.email, "Registration Update — NK Public School", html);
    } catch (emailError) {
      console.error("Failed to send rejection email:", emailError);
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("Reject registration error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
