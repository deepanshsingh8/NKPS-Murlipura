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

    // Account-enumeration guard: this is a public, unauthenticated endpoint, so
    // the response must look identical whether or not the email already has an
    // account or a pending request. We branch internally (skip the insert when
    // a profile/pending request already exists) but always return the same
    // generic success — an attacker can't tell members from non-members. The
    // trade-off (a returning user gets no "sign in instead" hint) was chosen
    // deliberately over the leak.
    const genericSuccess = NextResponse.json({ success: true });

    const { data: existingProfile } = await supabase
      .from("profiles")
      .select("id")
      .eq("email", email)
      .maybeSingle();

    const { data: existingRequest } = await supabase
      .from("registration_requests")
      .select("id")
      .eq("email", email)
      .eq("status", "pending")
      .maybeSingle();

    if (existingProfile || existingRequest) {
      // Nothing to do — don't create a duplicate request, don't email, don't
      // reveal which case it was. Logged server-side for admin visibility only.
      console.info(
        `[register] suppressed duplicate registration for an existing ${existingProfile ? "account" : "pending request"}`
      );
      return genericSuccess;
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

    return genericSuccess;
  } catch (err) {
    console.error("Registration API error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
