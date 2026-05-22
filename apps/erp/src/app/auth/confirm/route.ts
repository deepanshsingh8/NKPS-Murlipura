import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import type { EmailOtpType } from "@supabase/supabase-js";

// Handles email-link confirmations (recovery, magiclink, invite, etc.) using
// the token_hash + verifyOtp pattern. This bypasses Supabase's /auth/v1/verify
// redirect — no dependency on Supabase's redirect-allowlist or flow-type
// configuration, and the session is established server-side with cookies set
// on the redirect response.
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const token_hash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  const next = searchParams.get("next") ?? "/portal/login";

  const isPasswordReset = next.startsWith("/portal/reset-password");

  if (!token_hash || !type) {
    const errorRedirect = isPasswordReset
      ? `/portal/reset-password?error_description=${encodeURIComponent("Invalid or expired reset link. Please request a new one.")}`
      : `/portal/login?error=missing_token`;
    return NextResponse.redirect(`${origin}${errorRedirect}`);
  }

  const response = NextResponse.redirect(`${origin}${next}`);

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  const { error } = await supabase.auth.verifyOtp({ token_hash, type });

  if (error) {
    const errorRedirect = isPasswordReset
      ? `/portal/reset-password?error_description=${encodeURIComponent(error.message)}`
      : `/portal/login?error=${encodeURIComponent(error.message)}`;
    return NextResponse.redirect(`${origin}${errorRedirect}`);
  }

  return response;
}
