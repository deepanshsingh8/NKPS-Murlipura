import { NextResponse } from "next/server";
import { createAdminClient } from "@nkps/shared/lib/supabase/admin";
import { sendEmail, buildPasswordResetEmail } from "@nkps/shared/lib/email";
import { SCHOOL } from "@nkps/shared/lib/constants";
import { rateLimit, clientIp } from "@nkps/shared/lib/rate-limit";

// Always wait at least this long before responding so an attacker can't tell
// from latency whether the email was registered or not.
const MIN_RESPONSE_MS = 600;

export async function POST(request: Request) {
  const startedAt = Date.now();
  const finalize = async <T>(payload: T, status = 200) => {
    const elapsed = Date.now() - startedAt;
    if (elapsed < MIN_RESPONSE_MS) {
      await new Promise((r) => setTimeout(r, MIN_RESPONSE_MS - elapsed));
    }
    return NextResponse.json(payload as object, { status });
  };

  try {
    const { email } = await request.json();

    if (!email || typeof email !== "string") {
      return finalize({ error: "Email is required" }, 400);
    }

    const normalizedEmail = email.trim().toLowerCase();

    // Two-tier rate limit: prevents both per-IP floods and per-target spamming.
    const ipLimit = rateLimit({
      name: "forgot-password:ip",
      key: clientIp(request),
      max: 10,
      windowSeconds: 15 * 60,
    });
    if (!ipLimit.ok) {
      return finalize(
        { error: "Too many requests. Try again later." },
        429
      );
    }
    const emailLimit = rateLimit({
      name: "forgot-password:email",
      key: normalizedEmail,
      max: 3,
      windowSeconds: 15 * 60,
    });
    if (!emailLimit.ok) {
      // Don't reveal that this specific email is throttled — return the
      // standard success shape so we don't leak which addresses are registered.
      return finalize({ success: true });
    }

    // Derive the site origin from the request so the reset link always points
    // at the same host the user is currently on (production, Vercel preview,
    // localhost) — falling back to the configured ERP URL since /auth/confirm
    // and the reset-password page both live on the ERP app.
    const { getErpUrl } = await import("@nkps/shared/lib/cross-app");
    const origin = request.headers.get("origin") || getErpUrl();

    const supabase = createAdminClient();

    // Ask Supabase to generate a one-time recovery token for this email.
    // If the email isn't registered, Supabase returns an error — we swallow
    // it and return success so the endpoint doesn't leak membership info.
    const { data, error } = await supabase.auth.admin.generateLink({
      type: "recovery",
      email: normalizedEmail,
    });

    if (error || !data?.properties?.hashed_token) {
      if (error) {
        console.error("generateLink error:", error.message);
      }
      return finalize({ success: true });
    }

    // Build our own link pointing at /auth/confirm. This avoids Supabase's
    // /auth/v1/verify redirect entirely — which is fragile across flow types
    // and redirect-allowlist configurations — and lets us verifyOtp
    // server-side with full control over the final destination.
    const tokenHash = data.properties.hashed_token;
    const resetLink = `${origin}/auth/confirm?token_hash=${encodeURIComponent(tokenHash)}&type=recovery&next=${encodeURIComponent("/portal/reset-password")}`;

    // Best-effort: personalise the greeting using the user's profile name.
    let fullName: string | undefined;
    const userId = data.user?.id;
    if (userId) {
      const { data: profile } = await supabase
        .from("profiles")
        .select("full_name")
        .eq("id", userId)
        .maybeSingle();
      if (profile?.full_name) fullName = profile.full_name;
    }

    try {
      const html = buildPasswordResetEmail({
        fullName,
        email: normalizedEmail,
        resetLink,
        expiresInMinutes: 60,
      });
      await sendEmail(
        normalizedEmail,
        `Reset your ${SCHOOL.shortName} portal password`,
        html
      );
    } catch (emailError) {
      console.error("Failed to send password reset email:", emailError);
      return finalize(
        { error: "We couldn't send the reset email. Please try again in a moment." },
        500
      );
    }

    return finalize({ success: true });
  } catch (err) {
    console.error("Forgot password API error:", err);
    return finalize({ error: "Internal server error" }, 500);
  }
}
