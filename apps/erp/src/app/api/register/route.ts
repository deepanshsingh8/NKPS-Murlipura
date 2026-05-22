import { NextResponse } from "next/server";
import { createAdminClient } from "@nkps/shared/lib/supabase/admin";
import { registrationRequestSchema } from "@nkps/shared/lib/validations";
import { sendEmail, buildRegistrationReceivedEmail } from "@nkps/shared/lib/email";
import { rateLimit, clientIp } from "@nkps/shared/lib/rate-limit";

export async function POST(request: Request) {
  try {
    // Public endpoint — cap at 5 registrations per IP per hour to keep the
    // admin queue clean. The window is generous enough to absorb a family of
    // siblings registering from one home network.
    const ipLimit = rateLimit({
      name: "register:ip",
      key: clientIp(request),
      max: 5,
      windowSeconds: 60 * 60,
    });
    if (!ipLimit.ok) {
      return NextResponse.json(
        { error: "Too many registration attempts. Please try again later." },
        { status: 429 }
      );
    }

    const body = await request.json();
    const result = registrationRequestSchema.safeParse(body);

    if (!result.success) {
      return NextResponse.json(
        { error: "Invalid data", details: result.error.flatten() },
        { status: 400 }
      );
    }

    const { full_name, email, phone, role, student_admission_no, relationship } = result.data;
    const supabase = createAdminClient();

    // Check if email already exists as an active user
    const { data: existingProfile } = await supabase
      .from("profiles")
      .select("id")
      .eq("email", email)
      .single();

    if (existingProfile) {
      return NextResponse.json(
        { error: "An account with this email already exists. Please sign in instead." },
        { status: 409 }
      );
    }

    // Check if there's already a pending registration for this email
    const { data: existingRequest } = await supabase
      .from("registration_requests")
      .select("id")
      .eq("email", email)
      .eq("status", "pending")
      .single();

    if (existingRequest) {
      return NextResponse.json(
        { error: "A registration request with this email is already pending review." },
        { status: 409 }
      );
    }

    // Insert the registration request
    const { error: insertError } = await supabase
      .from("registration_requests")
      .insert({
        full_name,
        email,
        phone: phone || null,
        role,
        student_admission_no: student_admission_no || null,
        relationship: relationship || null,
      });

    if (insertError) {
      console.error("Registration insert error:", insertError);
      return NextResponse.json(
        { error: "Failed to submit registration. Please try again." },
        { status: 500 }
      );
    }

    // Send confirmation email (non-blocking)
    try {
      const html = buildRegistrationReceivedEmail({ fullName: full_name, role });
      await sendEmail(email, `Registration Received — ${role.charAt(0).toUpperCase() + role.slice(1)}`, html);
    } catch (emailError) {
      console.error("Failed to send registration confirmation email:", emailError);
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("Registration API error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
