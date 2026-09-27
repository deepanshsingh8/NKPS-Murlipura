"use client";

import { createClient } from "@nkps/shared/lib/supabase/client";

// Face ID / fingerprint, on Supabase's own WebAuthn MFA.
//
// ── Why not hand-rolled ─────────────────────────────────────────────────────
// The obvious shape for this feature is a webauthn_credentials table, a
// challenge store, and an assertion verifier written against WebCrypto —
// several hundred lines of security-critical parsing (COSE keys, ASN.1 DER
// signatures, rpIdHash and flag checks) that would ship into a school's ERP
// without ever having been exercised against a real authenticator.
//
// @supabase/auth-js ships all of that as a first-party MFA factor type. The
// browser ceremony, the challenge lifecycle and the signature verification are
// theirs; what is left here is naming things and handling the failure cases.
// The API is marked experimental upstream, which is why every call below is
// treated as "may not be available" rather than "will work".
//
// ── What a passkey here does and does not do ────────────────────────────────
// Registering one adds an MFA factor to the account. Authenticating with it
// asks the device for Face ID / fingerprint and, on success, returns a fresh
// session at AAL2. That is what unlocks the app.
//
// It is deliberately NOT a way to sign in from signed out: an MFA factor
// verifies against an existing session, and passwordless first-factor sign-in
// is a different feature with a different threat model.

export interface BiometricFactor {
  id: string;
  friendlyName: string;
  createdAt: string;
}

/**
 * Does this device have a built-in authenticator (Face ID, Touch ID, Windows
 * Hello, a fingerprint reader) that we can register?
 *
 * Checked before offering the button rather than after: a "Set up Face ID"
 * control that always throws is worse than no control.
 */
export async function isBiometricCapable(): Promise<boolean> {
  if (typeof window === "undefined") return false;
  if (!window.PublicKeyCredential) return false;
  if (!window.isSecureContext) return false;
  try {
    return await window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
  } catch {
    return false;
  }
}

/** A name the user will recognise in a device list, e.g. "iPhone · Safari". */
export function describeThisDevice(): string {
  if (typeof navigator === "undefined") return "This device";
  const ua = navigator.userAgent;
  const platform =
    /iPhone/.test(ua) ? "iPhone"
    : /iPad/.test(ua) ? "iPad"
    : /Android/.test(ua) ? "Android"
    : /Macintosh/.test(ua) ? "Mac"
    : /Windows/.test(ua) ? "Windows"
    : "Device";
  const browser =
    /Edg\//.test(ua) ? "Edge"
    : /Chrome\//.test(ua) ? "Chrome"
    : /Firefox\//.test(ua) ? "Firefox"
    : /Safari\//.test(ua) ? "Safari"
    : "Browser";
  return `${platform} · ${browser}`;
}

export async function listBiometricFactors(): Promise<BiometricFactor[]> {
  const supabase = createClient();
  const { data, error } = await supabase.auth.mfa.listFactors();
  if (error || !data) return [];
  // listFactors buckets by type; webauthn may be absent on older servers.
  const all = (data.all ?? []).filter(
    (f) => f.factor_type === "webauthn" && f.status === "verified"
  );
  return all.map((f) => ({
    id: f.id,
    friendlyName: f.friendly_name || "Registered device",
    createdAt: f.created_at,
  }));
}

export type BiometricResult =
  | { ok: true }
  | {
      ok: false;
      reason: "cancelled" | "unsupported" | "not-enabled" | "error";
      message: string;
    };

// Two unrelated layers can fail here and they need different words.
//
// The browser THROWS. NotAllowedError covers both dismissing the prompt and
// letting it time out; neither is worth an error toast, because the user knows
// what they just did.
//
// GoTrue RETURNS. When WebAuthn MFA is switched off for the Supabase project it
// replies 422 with `mfa_webauthn_enroll_not_enabled` (registering) or
// `mfa_webauthn_verify_not_enabled` (unlocking), and that arrives as an
// AuthApiError — whose `name` is "AuthApiError", so the name matching below
// never sees it and the old generic branch put the raw string "MFA enroll is
// disabled for WebAuthn" in front of a school administrator. It is a project
// setting nobody can fix by tapping the button again, so it gets its own reason
// and the callers say so.
//
// Matched on `code` rather than through auth-js's `isAuthApiError` guard: the
// guard is itself only `isAuthError(error) && error.name === "AuthApiError"`,
// so it would tell us nothing that `code` does not, and importing it would add
// a dependency on @supabase/supabase-js from a package that does not declare
// one. `code` is undefined on browser DOMExceptions, so there is no overlap.
function classify(error: unknown): BiometricResult {
  const name = (error as { name?: string })?.name;
  const code = (error as { code?: string })?.code;
  const message =
    (error as { message?: string })?.message ?? "Could not complete the request";
  if (name === "NotAllowedError" || name === "AbortError") {
    return { ok: false, reason: "cancelled", message: "Cancelled" };
  }
  if (
    code === "mfa_webauthn_enroll_not_enabled" ||
    code === "mfa_webauthn_verify_not_enabled"
  ) {
    return {
      ok: false,
      reason: "not-enabled",
      message: "Face ID isn't switched on for this account yet.",
    };
  }
  if (name === "NotSupportedError" || name === "SecurityError") {
    return { ok: false, reason: "unsupported", message };
  }
  return { ok: false, reason: "error", message };
}

/**
 * The relying party these credentials belong to.
 *
 * A passkey is bound to its Relying Party ID forever. Left unset, auth-js fills
 * this in from the browser — `window.location.hostname` and
 * `[window.location.origin]` — which on this deployment means a credential
 * registered in the ERP would be bound to `erp.nkpublicschool.com` and simply
 * would not exist for the CMS, even though the CMS mounts the same App Lock.
 * It would also disagree with a project configured against the apex domain.
 *
 * So it is configuration, not a default: set NEXT_PUBLIC_WEBAUTHN_RP_ID to the
 * bare apex (`nkpublicschool.com` — no scheme, no port, no path) and list the
 * app origins in NEXT_PUBLIC_WEBAUTHN_RP_ORIGINS. Both must match what the
 * Supabase project has under Authentication -> Passkeys.
 *
 * Unset, this returns undefined and auth-js keeps its own defaults, so
 * localhost development is unaffected.
 *
 * Changing the RP ID after anyone has enrolled invalidates every passkey
 * already registered. It is worth getting right once.
 */
function relyingParty(): { rpId: string; rpOrigins?: string[] } | undefined {
  const rpId = process.env.NEXT_PUBLIC_WEBAUTHN_RP_ID;
  if (!rpId) return undefined;
  const origins = (process.env.NEXT_PUBLIC_WEBAUTHN_RP_ORIGINS ?? "")
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean);
  return origins.length > 0 ? { rpId, rpOrigins: origins } : { rpId };
}

/** Register this device. Prompts for Face ID / fingerprint immediately. */
export async function registerBiometric(
  friendlyName = describeThisDevice()
): Promise<BiometricResult> {
  try {
    const supabase = createClient();
    const webauthn = relyingParty();
    const { error } = await supabase.auth.mfa.webauthn.register({
      friendlyName,
      ...(webauthn ? { webauthn } : {}),
    });
    if (error) return classify(error);
    return { ok: true };
  } catch (error) {
    return classify(error);
  }
}

/** Prompt for Face ID / fingerprint against an already-registered factor. */
export async function authenticateBiometric(
  factorId: string
): Promise<BiometricResult> {
  try {
    const supabase = createClient();
    const webauthn = relyingParty();
    const { error } = await supabase.auth.mfa.webauthn.authenticate({
      factorId,
      ...(webauthn ? { webauthn } : {}),
    });
    if (error) return classify(error);
    return { ok: true };
  } catch (error) {
    return classify(error);
  }
}

export async function removeBiometric(factorId: string): Promise<BiometricResult> {
  try {
    const supabase = createClient();
    const { error } = await supabase.auth.mfa.unenroll({ factorId });
    if (error) return classify(error);
    return { ok: true };
  } catch (error) {
    return classify(error);
  }
}
