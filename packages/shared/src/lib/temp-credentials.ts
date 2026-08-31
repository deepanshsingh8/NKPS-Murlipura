import { createCipheriv, createDecipheriv, createHash, randomBytes } from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Temporary-password vault.
 *
 * Portal accounts are created with a generated password that is only delivered
 * by the welcome email. When email isn't configured, that password is lost the
 * moment the request ends — Supabase keeps only its hash — and the account
 * becomes unreachable. This module stores that password, encrypted, for the
 * single window in which an admin may still need to read it back and hand it
 * over in person: from issue until the user sets their own password.
 *
 * Boundaries that keep this honest:
 *  - Only pre-first-use temporary passwords are ever stored. A password the
 *    user chooses is never written here.
 *  - The row is deleted by a database trigger the instant
 *    `profiles.must_change_password` becomes false (migration 088), so a
 *    credential cannot outlive its window through any code path.
 *  - Ciphertext lives in `user_temp_credentials`, a table with RLS on and no
 *    policies — unreadable by every browser client, service role only.
 */

const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12;
const ENVELOPE_VERSION = "v1";

/**
 * The encryption key is derived from `TEMP_PASSWORD_SECRET` when set, falling
 * back to the service-role key so existing deployments keep working without a
 * new environment variable. Rotating whichever value is in use makes stored
 * ciphertexts undecryptable — that is recoverable (the admin re-issues a
 * password), never fatal.
 */
function encryptionKey(): Buffer {
  const secret =
    process.env.TEMP_PASSWORD_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!secret) {
    throw new Error(
      "Cannot encrypt temporary passwords: set TEMP_PASSWORD_SECRET (or SUPABASE_SERVICE_ROLE_KEY) in the environment."
    );
  }

  return createHash("sha256").update(secret).digest();
}

export function encryptTempPassword(plaintext: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, encryptionKey(), iv);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);

  return [
    ENVELOPE_VERSION,
    iv.toString("base64"),
    cipher.getAuthTag().toString("base64"),
    ciphertext.toString("base64"),
  ].join(":");
}

/**
 * Returns null rather than throwing on anything unreadable — a rotated key or
 * a hand-edited row should degrade to "no password on file, issue a new one",
 * not to a 500 on the admin's users page.
 */
export function decryptTempPassword(envelope: string): string | null {
  try {
    const [version, iv, tag, ciphertext] = envelope.split(":");
    if (version !== ENVELOPE_VERSION || !iv || !tag || !ciphertext) return null;

    const decipher = createDecipheriv(
      ALGORITHM,
      encryptionKey(),
      Buffer.from(iv, "base64")
    );
    decipher.setAuthTag(Buffer.from(tag, "base64"));

    return Buffer.concat([
      decipher.update(Buffer.from(ciphertext, "base64")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    return null;
  }
}

/**
 * Records the temporary password for `userId`, replacing any previous one and
 * resetting the reveal counters.
 *
 * Never throws: this is called from account-creation paths where a vault
 * failure must not roll back an otherwise-successful account. The caller gets
 * `false` and can tell the admin to issue a password from the users page.
 */
export async function storeTempPassword(
  admin: SupabaseClient,
  userId: string,
  password: string,
  issuedBy?: string | null
): Promise<boolean> {
  try {
    const { error } = await admin.from("user_temp_credentials").upsert(
      {
        user_id: userId,
        ciphertext: encryptTempPassword(password),
        issued_by: issuedBy || null,
        issued_at: new Date().toISOString(),
        last_revealed_at: null,
        last_revealed_by: null,
        reveal_count: 0,
      },
      { onConflict: "user_id" }
    );

    if (error) {
      console.error(`Failed to store temporary password for ${userId}:`, error);
      return false;
    }
    return true;
  } catch (err) {
    console.error(`Failed to encrypt temporary password for ${userId}:`, err);
    return false;
  }
}

export async function clearTempPassword(
  admin: SupabaseClient,
  userId: string
): Promise<void> {
  await admin.from("user_temp_credentials").delete().eq("user_id", userId);
}
