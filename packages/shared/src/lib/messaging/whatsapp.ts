import { createHmac, timingSafeEqual } from "node:crypto";

// Server-only WhatsApp Business client (Meta Cloud API, direct — no reseller).
//
// Structured to match telephony/exotel.ts, which is the house pattern for an
// external provider: a private readConfig() that returns null when
// unconfigured, an isXConfigured() predicate callers check before offering the
// feature, and a named throw when someone calls anyway.
//
// SECURITY: reads secrets from process.env and must only ever be imported by
// server code. No NEXT_PUBLIC_ var is used on purpose — the access token can
// send messages billed to the school.

const GRAPH_VERSION = "v21.0";

interface WhatsAppConfig {
  accessToken: string;
  phoneNumberId: string;
  appSecret: string;
  verifyToken: string;
}

function readConfig(): WhatsAppConfig | null {
  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const appSecret = process.env.WHATSAPP_APP_SECRET;
  const verifyToken = process.env.WHATSAPP_VERIFY_TOKEN;
  if (!accessToken || !phoneNumberId || !appSecret || !verifyToken) return null;
  return { accessToken, phoneNumberId, appSecret, verifyToken };
}

/** True when every secret needed to send and to verify a webhook is present. */
export function isWhatsAppConfigured(): boolean {
  return readConfig() !== null;
}

export const WHATSAPP_NOT_CONFIGURED = "WHATSAPP_NOT_CONFIGURED";

/**
 * Verifies Meta's webhook signature.
 *
 * This authenticates the PROVIDER, not the person. It proves the payload came
 * from Meta and was not tampered with; it says nothing about whose phone the
 * message came from. Identity is a separate problem — see the enrolment flow.
 *
 * Compared in constant time: a fast-fail comparison leaks the signature one
 * byte at a time to anyone willing to measure.
 */
export function verifyWebhookSignature(
  rawBody: string,
  signatureHeader: string | null
): boolean {
  const config = readConfig();
  if (!config || !signatureHeader?.startsWith("sha256=")) return false;

  const expected = createHmac("sha256", config.appSecret)
    .update(rawBody, "utf8")
    .digest("hex");
  const received = signatureHeader.slice("sha256=".length);

  const a = Buffer.from(expected, "hex");
  const b = Buffer.from(received, "hex");
  if (a.length !== b.length || a.length === 0) return false;
  return timingSafeEqual(a, b);
}

/** Meta's GET handshake when a webhook URL is first registered. */
export function verifyWebhookChallenge(
  mode: string | null,
  token: string | null,
  challenge: string | null
): string | null {
  const config = readConfig();
  if (!config || mode !== "subscribe" || !challenge) return null;
  if (token !== config.verifyToken) return null;
  return challenge;
}

export interface InboundMessage {
  from: string;
  waMessageId: string;
  text: string;
  timestamp: string;
}

/**
 * Pulls the text messages out of a webhook payload.
 *
 * Meta batches: one POST can carry several entries, each with several changes,
 * each with several messages. Non-text messages (images, stickers, location)
 * are dropped rather than half-handled — the assistant answers questions, and
 * pretending to understand a photo would be worse than saying nothing.
 */
export function parseInboundMessages(payload: unknown): InboundMessage[] {
  const out: InboundMessage[] = [];
  const root = payload as {
    entry?: { changes?: { value?: { messages?: unknown[] } }[] }[];
  };

  for (const entry of root?.entry ?? []) {
    for (const change of entry.changes ?? []) {
      for (const raw of change.value?.messages ?? []) {
        const m = raw as {
          from?: string;
          id?: string;
          type?: string;
          text?: { body?: string };
          timestamp?: string;
        };
        if (m.type !== "text" || !m.from || !m.id || !m.text?.body) continue;
        out.push({
          from: m.from,
          waMessageId: m.id,
          text: m.text.body,
          timestamp: m.timestamp ?? "",
        });
      }
    }
  }
  return out;
}

export interface StatusUpdate {
  waMessageId: string;
  status: string;
}

/** Delivery receipts, so whatsapp_messages reflects what actually happened. */
export function parseStatusUpdates(payload: unknown): StatusUpdate[] {
  const out: StatusUpdate[] = [];
  const root = payload as {
    entry?: { changes?: { value?: { statuses?: unknown[] } }[] }[];
  };
  for (const entry of root?.entry ?? []) {
    for (const change of entry.changes ?? []) {
      for (const raw of change.value?.statuses ?? []) {
        const s = raw as { id?: string; status?: string };
        if (!s.id || !s.status) continue;
        out.push({ waMessageId: s.id, status: mapStatus(s.status) });
      }
    }
  }
  return out;
}

/**
 * Provider status -> our CHECK-constrained enum.
 *
 * Anything unrecognised collapses to 'failed' rather than being written
 * through, so a new Meta status can never violate the constraint and lose the
 * row. Same rule as mapExotelStatus.
 */
export function mapStatus(raw: string | null | undefined): string {
  switch ((raw ?? "").toLowerCase()) {
    case "sent": return "sent";
    case "delivered": return "delivered";
    case "read": return "read";
    case "queued":
    case "accepted": return "queued";
    default: return "failed";
  }
}

export interface SendResult {
  waMessageId: string | null;
}

/**
 * Free-form reply, valid only inside the 24-hour customer service window that
 * the parent's own message opened.
 *
 * Not free any more: service messages became billable on 2026-10-01 at the
 * same rate as utility templates (~₹0.12-0.13 in India). Every reply costs, so
 * the per-parent rate limit is a cost control, not only an abuse control.
 */
export async function sendText(to: string, body: string): Promise<SendResult> {
  const config = readConfig();
  if (!config) throw new Error(WHATSAPP_NOT_CONFIGURED);

  const res = await fetch(
    `https://graph.facebook.com/${GRAPH_VERSION}/${config.phoneNumberId}/messages`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to,
        type: "text",
        // Link previews off: the assistant should never be a vector for a URL
        // rendered from database content.
        text: { preview_url: false, body },
      }),
    }
  );

  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`WHATSAPP_HTTP_${res.status}: ${detail.slice(0, 300)}`);
  }

  const json = (await res.json()) as { messages?: { id?: string }[] };
  return { waMessageId: json.messages?.[0]?.id ?? null };
}

/**
 * Approved template, the only thing sendable OUTSIDE the 24-hour window.
 *
 * Template bodies are approved by Meta, so the registry of names and their
 * variable order is code, reviewed and version-controlled, never a string a
 * caller assembles.
 */
export async function sendTemplate(
  to: string,
  templateName: string,
  variables: string[] = [],
  languageCode = "en"
): Promise<SendResult> {
  const config = readConfig();
  if (!config) throw new Error(WHATSAPP_NOT_CONFIGURED);

  const res = await fetch(
    `https://graph.facebook.com/${GRAPH_VERSION}/${config.phoneNumberId}/messages`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to,
        type: "template",
        template: {
          name: templateName,
          language: { code: languageCode },
          ...(variables.length > 0
            ? {
                components: [
                  {
                    type: "body",
                    parameters: variables.map((text) => ({ type: "text", text })),
                  },
                ],
              }
            : {}),
        },
      }),
    }
  );

  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`WHATSAPP_HTTP_${res.status}: ${detail.slice(0, 300)}`);
  }

  const json = (await res.json()) as { messages?: { id?: string }[] };
  return { waMessageId: json.messages?.[0]?.id ?? null };
}

/** The templates this app sends. Names must match what Meta approved. */
export const WHATSAPP_TEMPLATES = {
  /** Sent to a number we do not recognise. Confirms nothing about enrolment. */
  unknownNumber: "nkps_unknown_number",
  /** The one-time enrolment code. */
  verifyCode: "nkps_verify_code",
} as const;
