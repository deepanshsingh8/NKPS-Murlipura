import { type NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";

// Apps/cms proxy: simple auth gate.
// - Unauth users hitting any non-/login page → /login
// - Authed users on /login → /
// - Editors with no CMS-feature grants are not blocked at the proxy layer
//   here; the page-level / API-level checks handle that. Keeping this
//   proxy lean means cold-start is fast.
export async function proxy(request: NextRequest) {
  const pathname = request.nextUrl.pathname;
  const isLogin = pathname === "/login";

  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user && !isLogin) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  if (user && isLogin) {
    // Bounce to dashboard only if the caller can actually use the CMS:
    // admin/staff always; teachers only if they hold any editor capability.
    // Students/parents stay on the login page so they can sign out and re-enter
    // through the correct app.
    const { data: profile } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .single();
    let allowed = profile?.role === "admin" || profile?.role === "staff";
    if (!allowed && profile?.role === "teacher") {
      const { data: perm } = await supabase
        .from("editor_permissions")
        .select("feature_key")
        .eq("editor_id", user.id)
        .limit(1)
        .maybeSingle();
      allowed = !!perm;
    }
    if (allowed) {
      const url = request.nextUrl.clone();
      url.pathname = "/";
      return NextResponse.redirect(url);
    }
  }

  return supabaseResponse;
}

export const config = {
  matcher: [
    // Run on all paths EXCEPT static assets + Next.js internals + API routes.
    // The `.*\\.` arm excludes anything containing a literal dot — i.e. files
    // with extensions like /images/logo.png. Without it, the auth gate
    // intercepts public assets and the Image optimizer gets a 307 → null.
    "/((?!api|_next/static|_next/image|_next/dev|favicon.ico|.*\\.).*)",
  ],
};
