import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/portal/login";

  if (!code) {
    return NextResponse.redirect(`${origin}/portal/login?error=missing_code`);
  }

  const isPasswordReset = next.startsWith("/portal/reset-password");

  // Always exchange the code server-side. This avoids the PKCE "code verifier
  // not found" error that occurs when the reset link is opened in a different
  // browser/context (e.g. Gmail in-app browser on mobile).
  const response = NextResponse.redirect(
    `${origin}${isPasswordReset ? "/portal/reset-password" : next}`
  );

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

  const { error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    const errorRedirect = isPasswordReset
      ? `/portal/reset-password?error_description=${encodeURIComponent(error.message)}`
      : `/portal/login?error=${encodeURIComponent(error.message)}`;
    return NextResponse.redirect(`${origin}${errorRedirect}`);
  }

  return response;
}
