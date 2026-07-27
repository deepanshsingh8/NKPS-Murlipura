import { NextResponse } from "next/server";
import { createAdminClient } from "@nkps/shared/lib/supabase/admin";

// Clears the caller's own `must_change_password` flag using the service-role
// client.
//
// Why this route exists: migration 061 locked the `must_change_password`
// column (along with role/link columns) against writes from the browser
// (authenticated) client — only the service-role client or an admin may change
// it. The forced-password-change and reset-password flows used to clear the
// flag directly from the browser, which now fails silently, leaving the user
// stuck in a loop where every login bounces them back to /portal/change-password.
//
// This route deliberately does NOT use the verifyAdmin* helpers: those fail
// closed when `must_change_password = true`, which is exactly the state every
// legitimate caller of this endpoint is in. We only need to prove the request
// carries a valid access token, and we clear the flag for that token's own
// user — a caller can never affect anyone else's row.
export async function POST(request: Request) {
  const authHeader = request.headers.get("authorization");
  const accessToken = authHeader?.startsWith("Bearer ")
    ? authHeader.slice(7)
    : null;

  if (!accessToken) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();

  const {
    data: { user },
    error: userError,
  } = await admin.auth.getUser(accessToken);

  if (userError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { error } = await admin
    .from("profiles")
    .update({ must_change_password: false })
    .eq("id", user.id);

  if (error) {
    console.error("Failed to clear must_change_password:", error);
    return NextResponse.json(
      { error: "Failed to finalize the password change." },
      { status: 500 }
    );
  }

  return NextResponse.json({ success: true });
}
