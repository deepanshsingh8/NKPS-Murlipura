import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import {
  featureKeyForPath,
  isAdminOnlyPath,
} from "@nkps/shared/lib/permissions";

// updateSession is consumed by apps/erp's proxy.ts. The ERP app serves:
//   /              admin dashboard
//   /login         admin login
//   /people, /exams, /fees, /timetable, /calendar, /attendance, /academics,
//     /registrations  — admin/staff sub-areas, plus teachers with the
//     matching editor_permissions feature_key.
//   /portal/*      portal login + password flows (any role)
//   /teacher/*     teacher dashboard (teacher role only)
//   /student/*     student dashboard (student role only)
//   /parent/*      parent dashboard (parent role only)
//   /auth/*        Supabase auth callbacks (no proxy needed)
//
// CMS lives at apps/cms with its own simple proxy. Website lives at
// apps/website with no proxy.

const LOGIN_PAGES = ["/login", "/portal/login"];

const PORTAL_PUBLIC_PAGES = [
  "/portal/login",
  "/portal/register",
  "/portal/forgot-password",
  "/portal/reset-password",
];

function getDashboardPath(role: string): string {
  switch (role) {
    case "admin":
    case "staff":
      return "/";
    case "teacher":
      return "/teacher";
    case "student":
      return "/student";
    case "parent":
      return "/parent";
    default:
      return "/portal/login";
  }
}

function isLoginPage(pathname: string): boolean {
  return LOGIN_PAGES.some((page) => pathname === page);
}

function isPortalPublic(pathname: string): boolean {
  return PORTAL_PUBLIC_PAGES.some((page) => pathname === page);
}

// Inside apps/erp, every page route is "protected" except the explicit
// login / portal-public / auth-callback paths.
function isProtectedRoute(pathname: string): boolean {
  if (isLoginPage(pathname)) return false;
  if (isPortalPublic(pathname)) return false;
  if (pathname.startsWith("/auth/")) return false;
  return true;
}

// Admin-side pages are everything that isn't /portal, /teacher, /student,
// /parent, /auth, or /login. Used to decide editor permission gating.
function isAdminAreaPath(pathname: string): boolean {
  return (
    !pathname.startsWith("/portal") &&
    !pathname.startsWith("/teacher") &&
    !pathname.startsWith("/student") &&
    !pathname.startsWith("/parent") &&
    !pathname.startsWith("/auth") &&
    pathname !== "/login"
  );
}

export async function updateSession(request: NextRequest) {
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

  const pathname = request.nextUrl.pathname;

  // API routes: refresh session only, no redirect (handlers do their own auth).
  if (pathname.startsWith("/api/")) {
    return supabaseResponse;
  }

  // Unauthenticated → bounce to the right login page based on what they
  // were trying to reach.
  if (!user && isProtectedRoute(pathname)) {
    const url = request.nextUrl.clone();
    // Admin-area paths → /login; portal/teacher/student/parent → /portal/login.
    url.pathname = isAdminAreaPath(pathname) ? "/login" : "/portal/login";
    return NextResponse.redirect(url);
  }

  if (user) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("role, must_change_password")
      .eq("id", user.id)
      .single();

    const role = profile?.role ?? "student";
    const mustChangePassword = profile?.must_change_password ?? false;
    const dashboard = getDashboardPath(role);

    // Force password change — redirect everywhere except the change-password,
    // reset-password, and settings pages themselves.
    if (
      mustChangePassword &&
      pathname !== "/portal/change-password" &&
      pathname !== "/portal/reset-password" &&
      pathname !== "/portal/settings"
    ) {
      const url = request.nextUrl.clone();
      url.pathname = "/portal/change-password";
      return NextResponse.redirect(url);
    }

    // If password already changed, don't let users sit on the change-password page.
    if (!mustChangePassword && pathname === "/portal/change-password") {
      const url = request.nextUrl.clone();
      url.pathname = dashboard;
      return NextResponse.redirect(url);
    }

    // Logged-in user on a login page → bounce to their dashboard.
    if (isLoginPage(pathname)) {
      const url = request.nextUrl.clone();
      url.pathname = dashboard;
      return NextResponse.redirect(url);
    }

    // Admin-area role gate. Admin/staff may enter freely; teachers are allowed
    // in only if they hold at least one editor capability (per-feature gate
    // below filters them further). Students and parents are bounced.
    if (
      isAdminAreaPath(pathname) &&
      role !== "admin" &&
      role !== "staff" &&
      role !== "teacher"
    ) {
      const url = request.nextUrl.clone();
      url.pathname = dashboard;
      return NextResponse.redirect(url);
    }

    // Per-feature capability gate on the admin area. Admins bypass; everyone
    // else (staff and teachers) must hold the matching editor_permissions row.
    // Admin-only paths (e.g. /people/users) reject all non-admins.
    if (isAdminAreaPath(pathname) && role !== "admin") {
      if (isAdminOnlyPath(pathname)) {
        const url = request.nextUrl.clone();
        url.pathname = role === "teacher" ? "/teacher" : "/";
        return NextResponse.redirect(url);
      }
      const featureKey = featureKeyForPath(pathname);
      if (featureKey) {
        const { data: perm } = await supabase
          .from("editor_permissions")
          .select("feature_key")
          .eq("editor_id", user.id)
          .eq("feature_key", featureKey)
          .maybeSingle();
        if (!perm) {
          const url = request.nextUrl.clone();
          url.pathname = role === "teacher" ? "/teacher" : "/";
          return NextResponse.redirect(url);
        }
      } else if (pathname !== "/" && role === "teacher") {
        // Teacher hit an admin-area page that has no feature mapping (e.g. an
        // unmapped dashboard). Without a grant, they go back to /teacher.
        // Staff is allowed on the admin root and unmapped pages — their
        // sidebar will guide them to what they can actually use.
        const url = request.nextUrl.clone();
        url.pathname = "/teacher";
        return NextResponse.redirect(url);
      }
    }

    // Role-specific portal gates.
    if (pathname.startsWith("/teacher") && role !== "teacher") {
      const url = request.nextUrl.clone();
      url.pathname = dashboard;
      return NextResponse.redirect(url);
    }
    if (pathname.startsWith("/student") && role !== "student") {
      const url = request.nextUrl.clone();
      url.pathname = dashboard;
      return NextResponse.redirect(url);
    }
    if (pathname.startsWith("/parent") && role !== "parent") {
      const url = request.nextUrl.clone();
      url.pathname = dashboard;
      return NextResponse.redirect(url);
    }
  }

  return supabaseResponse;
}
