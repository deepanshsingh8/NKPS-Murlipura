import { NextResponse } from "next/server";
import { createAdminClient } from "@nkps/shared/lib/supabase/admin";
import { createClient } from "@nkps/shared/lib/supabase/server";
import { generateSecurePassword } from "@nkps/shared/lib/password";
import { storeTempPassword } from "@nkps/shared/lib/temp-credentials";
import { rateLimit } from "@nkps/shared/lib/rate-limit";
import { SCHOOL } from "@nkps/shared/lib/constants";
import { z } from "zod";

/**
 * Admin-initiated password reset.
 *
 * The self-service route (/api/portal/forgot-password) mails a recovery link,
 * which is the right flow and the one to use whenever it works. It does not
 * always work: it depends on RESEND_API_KEY and a verified sending domain, and
 * when either is missing the user is told an email is on its way that will
 * never arrive. There was then no way back into an account at all without
 * opening the Supabase dashboard.
 *
 * So this route does not depend on email to succeed. It sets a fresh temporary
 * password, flags the account for a forced change at next login, and RETURNS
 * the password to the admin who asked — to be read out or handed over in
 * person. The welcome-mail attempt is best effort on top; its failure is
 * reported, not fatal.
 *
 * Returning a credential in a response body is a deliberate trade. It is
 * confined to an admin-only route over TLS, the password is single-use in
 * practice because `must_change_password` forces a change before the account
 * can do anything, and /api/users has returned `generated_password` on a
 * failed welcome email since the beginning — this is the same bargain, made
 * explicit. It is never logged.
 */

const resetSchema = z.object({
  id: z.string().uuid("A user id is required"),
});

export async function POST(request: Request) {
  try {
    const serverSupabase = await createClient();
    const {
      data: { user },
    } = await serverSupabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { data: callerProfile } = await serverSupabase
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .single();

    // Admin only, and deliberately not editor-permissible: resetting a
    // password is taking over an account, which is not a feature grant anyone
    // should be able to hold on its own. /administration/users is admin-only forever
    // (ADMIN_ONLY_PREFIXES), and this endpoint matches it.
    if (!callerProfile || callerProfile.role !== "admin") {
      return NextResponse.json(
        { error: "Forbidden: admin access required" },
        { status: 403 }
      );
    }

    // A reset is the one operation that hands out a working credential, so it
    // is the one worth bounding even behind an admin gate: a stolen admin
    // session should not be able to walk the whole staff table.
    const limit = rateLimit({
      name: "erp-users-reset-password",
      key: user.id,
      max: 20,
      windowSeconds: 3600,
    });
    if (!limit.ok) {
      return NextResponse.json(
        {
          error: `Too many password resets in the last hour. Try again in ${Math.ceil(
            limit.resetSeconds / 60
          )} minute(s).`,
        },
        { status: 429 }
      );
    }

    const parsed = resetSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid data", details: parsed.error.flatten() },
        { status: 400 }
      );
    }
    const { id } = parsed.data;

    // Resetting your own password here would replace the credential of the
    // session doing the resetting. Use the normal change-password screen.
    if (id === user.id) {
      return NextResponse.json(
        {
          error:
            "Use Change Password on your own account — resetting it here would lock this session out.",
        },
        { status: 400 }
      );
    }

    const admin = createAdminClient();

    const { data: target, error: targetError } = await admin
      .from("profiles")
      .select("id, full_name, email, role")
      .eq("id", id)
      .maybeSingle();

    if (targetError) {
      console.error("[users.reset-password] profile read:", targetError);
      return NextResponse.json(
        { error: "Failed to look up that user" },
        { status: 500 }
      );
    }
    if (!target) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    const password = generateSecurePassword();

    const { error: updateError } = await admin.auth.admin.updateUserById(id, {
      password,
    });

    if (updateError) {
      // Never echo the Supabase message verbatim — it can name the policy that
      // rejected the value, which is more than the caller needs.
      console.error("[users.reset-password] updateUserById:", updateError.message);
      return NextResponse.json(
        { error: "Failed to reset the password" },
        { status: 500 }
      );
    }

    // Force a change at next login. A temporary password that has been read
    // aloud or written on a slip must not stay valid, and the proxy gate keys
    // on this flag. A failure here is reported rather than swallowed: the
    // password IS already changed by this point, so silently leaving the flag
    // off would hand out a permanent credential.
    const { error: flagError } = await admin
      .from("profiles")
      .update({ must_change_password: true })
      .eq("id", id);

    if (flagError) {
      console.error("[users.reset-password] must_change_password:", flagError);
    }

    // Murlipura: keep the new temporary password in the vault as well, so it
    // can be revealed again from "Pending passwords" until the user replaces
    // it. Best effort — storeTempPassword never throws.
    await storeTempPassword(admin, id, password, user.id);

    // Best effort. The reset has already succeeded without it.
    let emailWarning: string | null = null;
    if (target.email) {
      try {
        const { sendEmail, buildWelcomeEmail } = await import(
          "@nkps/shared/lib/email"
        );
        const { getErpUrl } = await import("@nkps/shared/lib/cross-app");
        await sendEmail(
          target.email as string,
          `Your ${SCHOOL.shortName} portal password has been reset`,
          buildWelcomeEmail({
            fullName: (target.full_name as string) ?? "",
            email: target.email as string,
            password,
            loginUrl: getErpUrl("/portal/login"),
            role: (target.role as string) ?? "staff",
          })
        );
      } catch (emailError) {
        console.error("[users.reset-password] welcome email:", emailError);
        emailWarning =
          emailError instanceof Error
            ? `Email not sent (${emailError.message}). Share the password below directly.`
            : "Email not sent. Share the password below directly.";
      }
    } else {
      emailWarning =
        "This account has no email address on record, so nothing could be sent. Share the password below directly.";
    }

    return NextResponse.json({
      success: true,
      full_name: target.full_name ?? null,
      email: target.email ?? null,
      temporary_password: password,
      must_change_password: !flagError,
      // Surfaced so the admin can tell the user they will be asked to change it.
      flag_warning: flagError
        ? "The forced password change could not be recorded, so this password will not expire on its own. Ask them to change it from their profile."
        : null,
      email_warning: emailWarning,
    });
  } catch (err) {
    console.error("[users.reset-password] unexpected:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
