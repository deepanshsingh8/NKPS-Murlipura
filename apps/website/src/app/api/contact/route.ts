import { NextResponse } from "next/server";
import { createAdminClient } from "@nkps/shared/lib/supabase/admin";
import { contactFormSchema } from "@nkps/shared/lib/validations";
import { SCHOOL } from "@nkps/shared/lib/constants";
import { rateLimit, clientIp } from "@nkps/shared/lib/rate-limit";

export async function POST(request: Request) {
  try {
    // Cap contact form to 5 submissions / IP / hour to keep the admin inbox
    // clean. Honest visitors rarely submit twice in a row.
    const ipLimit = rateLimit({
      name: "contact:ip",
      key: clientIp(request),
      max: 5,
      windowSeconds: 60 * 60,
    });
    if (!ipLimit.ok) {
      return NextResponse.json(
        { error: "Too many submissions. Please try again later." },
        { status: 429 }
      );
    }

    const body = await request.json();

    const result = contactFormSchema.safeParse(body);
    if (!result.success) {
      return NextResponse.json(
        { error: "Invalid form data", details: result.error.flatten() },
        { status: 400 }
      );
    }

    const supabase = createAdminClient();

    const { error } = await supabase.from("contact_submissions").insert({
      full_name: result.data.fullName,
      email: result.data.email,
      phone: result.data.phone,
      subject: result.data.subject,
      message: result.data.message,
      is_read: false,
    });

    if (error) {
      console.error("Supabase insert error:", error);
      return NextResponse.json(
        { error: "Failed to submit form" },
        { status: 500 }
      );
    }

    // Send notification email to admin (non-blocking)
    try {
      const { sendEmail, buildContactNotificationEmail } = await import(
        "@nkps/shared/lib/email"
      );
      const adminEmail =
        process.env.ADMIN_NOTIFICATION_EMAIL || SCHOOL.email[0];
      const html = buildContactNotificationEmail({
        fullName: result.data.fullName,
        email: result.data.email,
        phone: result.data.phone,
        subject: result.data.subject,
        message: result.data.message,
      });
      await sendEmail(
        adminEmail,
        `New Contact: ${result.data.subject}`,
        html
      );
    } catch (emailError) {
      console.error("Failed to send contact notification email:", emailError);
    }

    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
