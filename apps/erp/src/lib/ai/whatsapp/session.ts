import { createHash, randomInt, timingSafeEqual } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Turning a phone number into a parent we are willing to answer.
 *
 * A number is not identity. Meta's signature proves the message came from
 * Meta, not who is holding the handset — and handsets are shared, SIMs get
 * swapped, and carriers recycle numbers. So a number has to be enrolled once
 * before it sees any child's data.
 */

const OTP_TTL_MINUTES = 10;
const OTP_MAX_ATTEMPTS = 5;

function hashCode(phoneE164: string, code: string): string {
  // Salted with the phone number so the same six digits hash differently per
  // number — a stolen table cannot be attacked with one rainbow table for all
  // 900,000 possible codes.
  return createHash("sha256").update(`${phoneE164}:${code}`).digest("hex");
}

export interface ResolvedSender {
  parentId: string;
  studentIds: string[];
}

/**
 * Resolve an enrolled, unexpired number to a parent and their current wards.
 *
 * Wards are re-read from student_parents on EVERY message. Never cached in the
 * session row: a child who left the school between two messages must stop being
 * answerable immediately, and a session that carried a stale ward list would be
 * the thing standing in the way.
 */
export async function resolveWhatsAppSender(
  admin: SupabaseClient,
  phoneE164: string
): Promise<ResolvedSender | null> {
  const { data: session } = await admin
    .from("whatsapp_sessions")
    .select("parent_id, expires_at")
    .eq("phone_e164", phoneE164)
    .is("revoked_at", null)
    .maybeSingle();

  // Expiry is checked here rather than by a sweeper — there is no cron in this
  // repo, so an expiry that depended on one would silently never happen.
  if (!session || new Date(session.expires_at as string).getTime() < Date.now()) {
    return null;
  }

  const parentId = session.parent_id as string;

  const { data: links } = await admin
    .from("student_parents")
    .select("student_id")
    .eq("parent_id", parentId);

  const linked = (links ?? []).map((r) => r.student_id as string);
  if (linked.length === 0) return { parentId, studentIds: [] };

  const { data: year } = await admin
    .from("academic_years")
    .select("id")
    .eq("is_current", true)
    .limit(1)
    .maybeSingle();
  if (!year?.id) return { parentId, studentIds: [] };

  const { data: enrolled } = await admin
    .from("student_enrollments")
    .select("student_id")
    .eq("academic_year_id", year.id)
    .in("student_id", linked);

  return {
    parentId,
    studentIds: [...new Set((enrolled ?? []).map((r) => r.student_id as string))],
  };
}

/** Push the rolling window forward on activity. */
export async function touchSession(
  admin: SupabaseClient,
  phoneE164: string
): Promise<void> {
  const expires = new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString();
  await admin
    .from("whatsapp_sessions")
    .update({ last_seen_at: new Date().toISOString(), expires_at: expires })
    .eq("phone_e164", phoneE164)
    .is("revoked_at", null);
}

export type EnrolmentStart =
  | { status: "code_sent"; code: string }
  | { status: "unknown_number" }
  | { status: "ambiguous" };

/**
 * Begin enrolment for a number that isn't yet trusted.
 *
 * Two rules that matter more than they look:
 *
 *  - **Zero matches and several matches are both refusals.** We never guess
 *    which family a shared number belongs to, and we never confirm to the
 *    sender whether a number is on file — that would let anyone test numbers
 *    against the school's parent list.
 *  - The returned code is for the CALLER to send over an already-trusted
 *    channel. Only its hash is stored.
 */
export async function startEnrolment(
  admin: SupabaseClient,
  phoneE164: string
): Promise<EnrolmentStart> {
  const { data: links } = await admin
    .from("parent_phone_links")
    .select("parent_id")
    .eq("phone_e164", phoneE164)
    .is("revoked_at", null);

  const matches = links ?? [];
  if (matches.length === 0) return { status: "unknown_number" };
  if (matches.length > 1) return { status: "ambiguous" };

  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  await admin.from("parent_phone_otps").insert({
    phone_e164: phoneE164,
    code_hash: hashCode(phoneE164, code),
    parent_id: matches[0].parent_id as string,
    expires_at: new Date(Date.now() + OTP_TTL_MINUTES * 60_000).toISOString(),
  });

  return { status: "code_sent", code };
}

export type EnrolmentResult =
  | { status: "verified" }
  | { status: "wrong_code" }
  | { status: "expired" }
  | { status: "locked" }
  /** The code was right but the session could not be created. */
  | { status: "failed" };

/**
 * Complete enrolment with a code the sender supplied.
 *
 * Attempts are counted and capped: without that, six digits is a few thousand
 * guesses, which a script does in a minute.
 */
export async function completeEnrolment(
  admin: SupabaseClient,
  phoneE164: string,
  submittedCode: string
): Promise<EnrolmentResult> {
  const { data: otp } = await admin
    .from("parent_phone_otps")
    .select("id, code_hash, parent_id, attempts, expires_at, consumed_at")
    .eq("phone_e164", phoneE164)
    .is("consumed_at", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!otp) return { status: "expired" };
  if ((otp.attempts as number) >= OTP_MAX_ATTEMPTS) return { status: "locked" };
  if (new Date(otp.expires_at as string).getTime() < Date.now()) {
    return { status: "expired" };
  }

  const expected = Buffer.from(otp.code_hash as string, "hex");
  const actual = Buffer.from(hashCode(phoneE164, submittedCode.trim()), "hex");
  const matches =
    expected.length === actual.length && timingSafeEqual(expected, actual);

  if (!matches) {
    await admin
      .from("parent_phone_otps")
      .update({ attempts: (otp.attempts as number) + 1 })
      .eq("id", otp.id as string);
    return { status: "wrong_code" };
  }

  await admin
    .from("parent_phone_otps")
    .update({ consumed_at: new Date().toISOString() })
    .eq("id", otp.id as string);

  await admin
    .from("parent_phone_links")
    .update({ verified_at: new Date().toISOString(), verified_via: "otp" })
    .eq("phone_e164", phoneE164)
    .is("revoked_at", null);

  // Revoke-then-insert, NOT upsert.
  //
  // whatsapp_sessions_active is a PARTIAL unique index (WHERE revoked_at IS
  // NULL). Postgres will not match `ON CONFLICT (phone_e164)` to a partial
  // index unless the statement repeats the predicate, which PostgREST's
  // onConflict cannot express — so the upsert fails outright with "there is no
  // unique or exclusion constraint matching the ON CONFLICT specification".
  // Revoking first leaves at most one live row, which the index then accepts.
  await admin
    .from("whatsapp_sessions")
    .update({ revoked_at: new Date().toISOString() })
    .eq("phone_e164", phoneE164)
    .is("revoked_at", null);

  const { error: sessionError } = await admin.from("whatsapp_sessions").insert({
    parent_id: otp.parent_id as string,
    phone_e164: phoneE164,
    verified_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString(),
    last_seen_at: new Date().toISOString(),
  });

  // Report the failure rather than claiming success. Saying "this number is
  // now linked" when no session exists sends the parent back into enrolment
  // on their next message with no idea why — and the code they just used is
  // already consumed.
  if (sessionError) {
    console.error("[whatsapp] session create failed:", sessionError.message);
    return { status: "failed" };
  }

  return { status: "verified" };
}

/** Last four digits, for the message log. The full number is never stored. */
export function phoneLast4(phoneE164: string): string {
  return phoneE164.slice(-4);
}
