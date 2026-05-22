import { type NextRequest } from "next/server";
import { updateSession } from "@nkps/shared/lib/supabase/middleware";

// apps/erp serves admin (root /), /portal, /teacher, /student, /parent.
// Auth, role gating, and editor permission checks live in @nkps/shared
// updateSession.
export async function proxy(request: NextRequest) {
  return await updateSession(request);
}

export const config = {
  matcher: [
    // Run on all paths EXCEPT static assets + Next.js internals + auth callback.
    // The `.*\\.` arm excludes anything containing a literal dot — i.e. files
    // with extensions like /images/logo.png. Without it, the auth gate
    // intercepts public assets and the Image optimizer gets a 307 → null.
    "/((?!_next/static|_next/image|_next/dev|favicon.ico|.*\\.).*)",
  ],
};
