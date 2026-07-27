// Server-only Exotel client for click-to-call with number masking.
//
// Flow (Exotel "Connect two numbers"): we hand Exotel the staff member's phone
// (From / agent leg) and the parent's phone (To / customer leg) plus our
// ExoPhone as CallerId. Exotel rings the staff first, then bridges to the
// parent. BOTH parties see the CallerId (the ExoPhone), so neither sees the
// other's real number — that's the masking.
//
// SECURITY: this module reads secrets from process.env and must only ever be
// imported by server code (API routes). Nothing here is safe for the browser
// bundle. No NEXT_PUBLIC_ vars are used on purpose.

interface ExotelConfig {
  sid: string;
  apiKey: string;
  apiToken: string;
  subdomain: string;
  callerId: string;
}

function readConfig(): ExotelConfig | null {
  const sid = process.env.EXOTEL_SID;
  const apiKey = process.env.EXOTEL_API_KEY;
  const apiToken = process.env.EXOTEL_API_TOKEN;
  const callerId = process.env.EXOTEL_CALLER_ID;
  // Subdomain defaults to the standard Exotel API host; Indian accounts may be
  // on api.in.exotel.com — overridable without a code change.
  const subdomain = process.env.EXOTEL_SUBDOMAIN || "api.exotel.com";
  if (!sid || !apiKey || !apiToken || !callerId) return null;
  return { sid, apiKey, apiToken, subdomain, callerId };
}

/** True when every Exotel secret needed to place a call is present. */
export function isTelephonyConfigured(): boolean {
  return readConfig() !== null;
}

/**
 * Normalize an Indian phone number to E.164 (+91XXXXXXXXXX), or null if it
 * isn't a plausible Indian mobile. Kept deliberately strict — a malformed
 * number should be rejected before we spend money placing a call.
 *
 * Accepts: 10-digit mobiles (6-9 leading), a leading 0, a 91/+91 country code.
 */
export function normalizeIndianMobile(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let digits = String(raw).replace(/[^\d]/g, "");
  // Strip country code / trunk prefixes down to the core 10 digits.
  if (digits.length === 12 && digits.startsWith("91")) digits = digits.slice(2);
  else if (digits.length === 11 && digits.startsWith("0")) digits = digits.slice(1);
  if (digits.length !== 10) return null;
  if (!/^[6-9]\d{9}$/.test(digits)) return null;
  return `+91${digits}`;
}

export interface ConnectCallParams {
  /** Staff member's phone — Exotel rings this leg first. */
  agentPhone: string;
  /** Parent/guardian/student phone — bridged in once the agent picks up. */
  customerPhone: string;
  /** Absolute URL Exotel POSTs call-status updates to (carries our token). */
  statusCallbackUrl: string;
  /**
   * Our own correlation id (the call_logs row id). Exotel echoes it back in the
   * status callback as `CustomField`, so we can always reconcile the row — even
   * on the rare 2xx whose body we can't parse a Sid out of.
   */
  customField?: string;
}

export interface ConnectCallResult {
  sid: string | null;
  status: string;
}

/**
 * Place a masked bridge call via Exotel. Throws if telephony isn't configured
 * or the Exotel API rejects the request; the caller decides how to surface it.
 */
export async function connectCall(params: ConnectCallParams): Promise<ConnectCallResult> {
  const config = readConfig();
  if (!config) throw new Error("EXOTEL_NOT_CONFIGURED");

  const endpoint = `https://${config.subdomain}/v1/Accounts/${config.sid}/Calls/connect.json`;
  const auth = Buffer.from(`${config.apiKey}:${config.apiToken}`).toString("base64");

  const form = new URLSearchParams({
    From: params.agentPhone,
    To: params.customerPhone,
    CallerId: config.callerId,
    // Transactional call (not promotional) — required for DND-registered
    // numbers to still connect on a legitimate school↔parent call.
    CallType: "trans",
    StatusCallback: params.statusCallbackUrl,
    ...(params.customField ? { CustomField: params.customField } : {}),
  });

  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: form.toString(),
  });

  const text = await res.text();
  if (!res.ok) {
    throw new Error(`EXOTEL_HTTP_${res.status}: ${text.slice(0, 300)}`);
  }

  // Exotel returns { "Call": { "Sid": "...", "Status": "queued", ... } }.
  let sid: string | null = null;
  let status = "queued";
  try {
    const json = JSON.parse(text) as { Call?: { Sid?: string; Status?: string } };
    sid = json.Call?.Sid ?? null;
    status = json.Call?.Status ?? "queued";
  } catch {
    // A 2xx with an unparseable body still means Exotel accepted the call;
    // fall back to the default status and let the webhook reconcile.
  }

  return { sid, status };
}

/**
 * Map an Exotel call status string to one of our call_logs status values.
 * Exotel already uses queued/in-progress/completed/failed/busy/no-answer;
 * anything unrecognized collapses to 'failed' so we never write an
 * out-of-CHECK value.
 */
export function mapExotelStatus(raw: string | null | undefined): string {
  const s = String(raw ?? "").toLowerCase().trim();
  const allowed = new Set([
    "queued",
    "in-progress",
    "completed",
    "failed",
    "busy",
    "no-answer",
    "canceled",
  ]);
  if (allowed.has(s)) return s;
  if (s === "cancelled") return "canceled";
  if (s === "in progress" || s === "inprogress") return "in-progress";
  if (s === "noanswer" || s === "no answer") return "no-answer";
  return "failed";
}
