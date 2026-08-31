import { NextResponse } from "next/server";
import { verifyAdminWithUser } from "@nkps/shared/lib/verify-admin";
import { generateSecurePassword } from "@nkps/shared/lib/password";
import {
  decryptTempPassword,
  storeTempPassword,
} from "@nkps/shared/lib/temp-credentials";
import { rateLimit } from "@nkps/shared/lib/rate-limit";

/**
 * Admin access to the temporary-password vault (migration 088).
 *
 * The problem this solves: portal accounts are created with a generated
 * password that only ever leaves the server inside the welcome email. With
 * email delivery unconfigured, those accounts exist but nobody knows their
 * password. This route lets an admin read back (or re-issue) that temporary
 * password so it can be handed to the person directly.
 *
 * Three actions, all admin-only:
 *   GET               — which accounts currently have a password on file.
 *   POST "reveal"     — decrypt and return one account's temporary password.
 *   POST "issue"      — generate a fresh temporary password for accounts that
 *                       still have not set their own (bulk-capable).
 *   POST "reset"      — force an account that HAS set its own password back to
 *                       a temporary one. Deliberately separate from "issue" so
 *                       the everyday path can never silently invalidate a
 *                       working password.
 *
 * Invariant that the whole feature rests on: a temporary password is readable
 * only while `profiles.must_change_password` is true. The moment the user sets
 * their own password that flag clears and the database trigger deletes the
 * vault row, so "reveal" has nothing left to return.
 */

// Bulk issue is what makes an onboarding wave practical; the cap keeps a
// compromised admin token from rewriting every password in the school at once.
const MAX_ISSUE_PER_CALL = 100;

interface VaultRow {
  user_id: string;
  issued_at: string;
  last_revealed_at: string | null;
  reveal_count: number;
}

export async function GET(request: Request) {
  const auth = await verifyAdminWithUser();
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { admin } = auth;

  const idsParam = new URL(request.url).searchParams.get("ids");
  let query = admin
    .from("user_temp_credentials")
    .select("user_id, issued_at, last_revealed_at, reveal_count");

  if (idsParam) {
    const ids = idsParam.split(",").map((s) => s.trim()).filter(Boolean);
    if (ids.length === 0) return NextResponse.json({ credentials: [] });
    query = query.in("user_id", ids);
  }

  const { data, error } = await query;

  if (error) {
    console.error("Failed to list temporary credentials:", error);
    return NextResponse.json(
      { error: "Failed to load password status" },
      { status: 500 }
    );
  }

  // Metadata only — no ciphertext leaves the server here, and no plaintext
  // without an explicit per-user "reveal".
  return NextResponse.json({ credentials: (data ?? []) as VaultRow[] });
}

export async function POST(request: Request) {
  const auth = await verifyAdminWithUser();
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { admin, user } = auth;

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const { action } = body as { action?: string };

  if (action === "reveal") {
    const { id } = body as { id?: string };
    if (!id) {
      return NextResponse.json({ error: "User id is required" }, { status: 400 });
    }

    // Revealing is cheap but it is the one call that emits a plaintext
    // credential, so it gets its own budget and its own audit trail.
    const limit = rateLimit({
      name: "temp-password-reveal",
      key: user.id,
      max: 120,
      windowSeconds: 3600,
    });
    if (!limit.ok) {
      return NextResponse.json(
        { error: "Too many password reveals. Try again later." },
        { status: 429 }
      );
    }

    const { data: profile } = await admin
      .from("profiles")
      .select("full_name, email, must_change_password")
      .eq("id", id)
      .maybeSingle();

    if (!profile) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }
    if (!profile.must_change_password) {
      // The trigger has already deleted the row; say why rather than 404.
      return NextResponse.json(
        {
          error:
            "This user has already set their own password, so there is no temporary password to show.",
        },
        { status: 409 }
      );
    }

    const { data: row } = await admin
      .from("user_temp_credentials")
      .select("ciphertext, issued_at, reveal_count")
      .eq("user_id", id)
      .maybeSingle();

    if (!row) {
      return NextResponse.json(
        {
          error:
            "No temporary password is on file for this account. Issue a new one to continue.",
          can_issue: true,
        },
        { status: 404 }
      );
    }

    const password = decryptTempPassword(row.ciphertext as string);
    if (!password) {
      // Key rotated, or the row was tampered with. Recoverable — issue again.
      return NextResponse.json(
        {
          error:
            "The stored password could not be decrypted (the encryption key may have changed). Issue a new one to continue.",
          can_issue: true,
        },
        { status: 409 }
      );
    }

    await admin
      .from("user_temp_credentials")
      .update({
        last_revealed_at: new Date().toISOString(),
        last_revealed_by: user.id,
        reveal_count: ((row as { reveal_count?: number }).reveal_count ?? 0) + 1,
      })
      .eq("user_id", id);

    return NextResponse.json({
      password,
      issued_at: row.issued_at,
      full_name: profile.full_name,
      email: profile.email,
    });
  }

  if (action === "issue" || action === "reset") {
    const raw = (body as { ids?: unknown }).ids;
    const ids = Array.isArray(raw)
      ? raw.filter((v): v is string => typeof v === "string" && v.length > 0)
      : typeof (body as { id?: unknown }).id === "string"
        ? [(body as { id: string }).id]
        : [];

    if (ids.length === 0) {
      return NextResponse.json(
        { error: "At least one user id is required" },
        { status: 400 }
      );
    }
    if (ids.length > MAX_ISSUE_PER_CALL) {
      return NextResponse.json(
        { error: `Too many users in one call. Max ${MAX_ISSUE_PER_CALL}.` },
        { status: 400 }
      );
    }

    // Issuing rewrites real credentials, so it is budgeted more tightly than
    // reveals — 10 calls of up to 100 users covers any realistic onboarding.
    const limit = rateLimit({
      name: "temp-password-issue",
      key: user.id,
      max: 10,
      windowSeconds: 3600,
    });
    if (!limit.ok) {
      return NextResponse.json(
        {
          error: `Password-issue rate limit hit. Try again in ${Math.ceil(
            limit.resetSeconds / 60
          )} minute(s).`,
        },
        { status: 429 }
      );
    }

    // Resetting your own account would set must_change_password on the very
    // profile this route authenticates against — verifyAdmin* fails closed on
    // that flag, locking you out of every admin API until you log in again
    // through the forced-change screen. Refuse instead of stranding the admin.
    if (ids.includes(user.id)) {
      return NextResponse.json(
        {
          error:
            "You cannot issue a temporary password for your own account. Change your password from your profile instead.",
        },
        { status: 400 }
      );
    }

    const { data: profiles, error: profileError } = await admin
      .from("profiles")
      .select("id, full_name, email, must_change_password")
      .in("id", ids);

    if (profileError) {
      console.error("Failed to load profiles for issue:", profileError);
      return NextResponse.json(
        { error: "Failed to load the selected users" },
        { status: 500 }
      );
    }

    const byId = new Map(
      (profiles ?? []).map((p) => [p.id as string, p])
    );

    const results: {
      id: string;
      name: string;
      email: string;
      password?: string;
      error?: string;
    }[] = [];

    for (const id of ids) {
      const profile = byId.get(id);
      if (!profile) {
        results.push({ id, name: "", email: "", error: "User not found" });
        continue;
      }

      const name = (profile.full_name as string) ?? "";
      const email = (profile.email as string) ?? "";

      // "issue" is the safe everyday action: it only ever touches accounts that
      // have never set a password, so it can never invalidate a password
      // someone is already using. Overwriting a live password is "reset", which
      // the UI asks for explicitly.
      if (action === "issue" && !profile.must_change_password) {
        results.push({
          id,
          name,
          email,
          error: "Already set their own password — use Reset password instead.",
        });
        continue;
      }

      const password = generateSecurePassword();

      const { error: authError } = await admin.auth.admin.updateUserById(id, {
        password,
      });
      if (authError) {
        console.error(`Failed to set password for ${id}:`, authError);
        results.push({ id, name, email, error: authError.message });
        continue;
      }

      // Force the change on next login. Do this BEFORE vaulting: the
      // migration-088 trigger deletes vault rows when the flag goes false, and
      // this update is the only thing that could flip it — writing the flag
      // first means the row we store afterwards is never swept away by our own
      // update. (It also keeps the invariant true if vaulting then fails: the
      // account is in "must change" state with no readable password, which the
      // UI reports as "issue a new one".)
      const { error: flagError } = await admin
        .from("profiles")
        .update({ must_change_password: true })
        .eq("id", id);
      if (flagError) {
        console.error(`Failed to force password change for ${id}:`, flagError);
        results.push({
          id,
          name,
          email,
          error: "Password was changed but the forced-change flag failed to set.",
        });
        continue;
      }

      const stored = await storeTempPassword(admin, id, password, user.id);

      results.push({
        id,
        name,
        email,
        password,
        // A vault failure is not fatal — the password in this response is still
        // valid — but the admin must be told it won't be readable again.
        ...(stored
          ? {}
          : {
              error:
                "Password set, but it could not be saved for later viewing. Copy it now.",
            }),
      });
    }

    return NextResponse.json({
      results,
      issued: results.filter((r) => r.password).length,
      failed: results.filter((r) => !r.password).length,
    });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
