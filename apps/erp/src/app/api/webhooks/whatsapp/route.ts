import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@nkps/shared/lib/supabase/admin";
import { getSchoolProfile } from "@nkps/shared/lib/school-profile";
import { normalizeIndianMobile } from "@nkps/shared/lib/telephony/exotel";
import {
  isWhatsAppConfigured,
  verifyWebhookSignature,
  verifyWebhookChallenge,
  parseInboundMessages,
  parseStatusUpdates,
  sendText,
  sendTemplate,
  WHATSAPP_TEMPLATES,
} from "@nkps/shared/lib/messaging/whatsapp";
import { isAiConfigured, AI_MODELS } from "@/lib/ai/client";
import { startConversation } from "@/lib/ai/audit";
import { runParentTurn, buildParentSystemPrompt } from "@/lib/ai/parent-runner";
import { checkWhatsAppLimits } from "@/lib/ai/rate-limit-db";
import {
  resolveWhatsAppSender,
  touchSession,
  startEnrolment,
  completeEnrolment,
  phoneLast4,
} from "@/lib/ai/whatsapp/session";
import type { CallerContext, RowScope } from "@/lib/ai/caller-context";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Meta's registration handshake.
 */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const challenge = verifyWebhookChallenge(
    params.get("hub.mode"),
    params.get("hub.verify_token"),
    params.get("hub.challenge")
  );
  if (!challenge) {
    return new NextResponse("Forbidden", { status: 403 });
  }
  return new NextResponse(challenge, {
    status: 200,
    headers: { "Content-Type": "text/plain" },
  });
}

/**
 * Inbound WhatsApp messages.
 *
 * ── Always 200 ──────────────────────────────────────────────────────────────
 * Except for a failed signature. Meta retries on any non-2xx, and a retry
 * cannot fix a bug in our handler — it just multiplies the damage and the
 * bill. Same reasoning as the Exotel callback.
 *
 * ── The order of the gates is the security design ───────────────────────────
 * signature -> normalise -> rate limit -> enrolment -> scope -> model.
 * Nothing reaches the model, and no student data is touched, until the sender
 * is a known parent. An unrecognised number gets one template and nothing else.
 */
export async function POST(request: NextRequest) {
  const rawBody = await request.text();

  if (!isWhatsAppConfigured()) {
    // Nothing to verify against, so nothing can be trusted. 200 so Meta stops.
    console.error("[whatsapp] inbound while unconfigured — ignoring");
    return NextResponse.json({ ok: true });
  }

  // The ONLY 403. Everything past here is a real Meta payload.
  if (!verifyWebhookSignature(rawBody, request.headers.get("x-hub-signature-256"))) {
    return new NextResponse("Invalid signature", { status: 403 });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ ok: true });
  }

  const admin = createAdminClient();

  // Delivery receipts first — cheap, and they carry no identity.
  for (const status of parseStatusUpdates(payload)) {
    await admin
      .from("whatsapp_messages")
      .update({ status: status.status, updated_at: new Date().toISOString() })
      .eq("wa_message_id", status.waMessageId);
  }

  const messages = parseInboundMessages(payload);
  for (const message of messages) {
    try {
      await handleInbound(admin, message.from, message.text, message.waMessageId);
    } catch (err) {
      // One bad message must not cost us the rest of the batch, and must not
      // make Meta retry the whole thing.
      console.error("[whatsapp] handler failed:", err);
    }
  }

  return NextResponse.json({ ok: true });
}

async function handleInbound(
  admin: ReturnType<typeof createAdminClient>,
  from: string,
  text: string,
  waMessageId: string
): Promise<void> {
  // Meta sends the number without a '+'. Normalise with the same helper the
  // telephony path uses, so one definition of "an Indian mobile" holds.
  const phone = normalizeIndianMobile(from) ?? (from.startsWith("+") ? from : `+${from}`);

  await admin.from("whatsapp_messages").insert({
    direction: "inbound",
    phone_last4: phoneLast4(phone),
    wa_message_id: waMessageId,
    status: "received",
    category: "service",
  });

  const sender = await resolveWhatsAppSender(admin, phone);

  // Rate limits BEFORE anything expensive, and before the model.
  const limits = await checkWhatsAppLimits(admin, phone, sender?.parentId ?? null);
  if (!limits.ok) {
    await reply(admin, phone, limits.reason!, sender?.parentId ?? null);
    return;
  }

  // ── Not enrolled ──────────────────────────────────────────────────────────
  if (!sender) {
    const code = text.trim().match(/^\d{6}$/)?.[0];
    if (code) {
      const outcome = await completeEnrolment(admin, phone, code);
      const line = {
        verified: "Thanks — this number is now linked. Ask me about attendance, fees, results, the timetable or PTM dates.",
        wrong_code: "That code doesn't match. Please check and try again.",
        expired: "That code has expired. Send any message to get a new one.",
        locked: "Too many incorrect attempts. Please contact the school office.",
        failed: "Something went wrong linking this number. Please contact the school office.",
      }[outcome.status];
      await reply(admin, phone, line, null);
      return;
    }

    const enrolment = await startEnrolment(admin, phone);
    if (enrolment.status === "code_sent") {
      // The code goes out over WhatsApp here for simplicity of the first
      // release. It is a weak factor on its own — anyone holding the handset
      // passes — so it proves possession of the number, not identity. The
      // stronger path is enrolling from inside the authenticated portal, and
      // a school that wants that can disable this branch.
      await sendTemplate(phone, WHATSAPP_TEMPLATES.verifyCode, [enrolment.code]);
      await admin.from("whatsapp_messages").insert({
        direction: "outbound",
        phone_last4: phoneLast4(phone),
        template_name: WHATSAPP_TEMPLATES.verifyCode,
        category: "authentication",
        status: "queued",
      });
      return;
    }

    // unknown_number AND ambiguous get the SAME reply. Telling the sender
    // which one it was would let anyone probe the school's parent list.
    await sendTemplate(phone, WHATSAPP_TEMPLATES.unknownNumber);
    await admin.from("whatsapp_messages").insert({
      direction: "outbound",
      phone_last4: phoneLast4(phone),
      template_name: WHATSAPP_TEMPLATES.unknownNumber,
      category: "utility",
      status: "queued",
    });
    return;
  }

  await touchSession(admin, phone);

  const school = await getSchoolProfile(admin);
  const office = school.phones[0] ? ` Please call the office on ${school.phones[0]}.` : "";

  if (!school.aiEnabled || !isAiConfigured()) {
    await reply(
      admin,
      phone,
      `Thanks for your message.${office || " Please contact the school office."}`,
      sender.parentId
    );
    return;
  }

  if (sender.studentIds.length === 0) {
    await reply(
      admin,
      phone,
      `I can't find a student linked to this number for the current session.${office}`,
      sender.parentId
    );
    return;
  }

  const { data: year } = await admin
    .from("academic_years")
    .select("id")
    .eq("is_current", true)
    .limit(1)
    .maybeSingle();
  if (!year?.id) {
    await reply(admin, phone, `The new session isn't open yet.${office}`, sender.parentId);
    return;
  }

  const { data: children } = await admin
    .from("students")
    .select("full_name")
    .in("id", sender.studentIds);
  const childNames = (children ?? []).map((c) => c.full_name as string);

  const scope: RowScope = { kind: "students", studentIds: sender.studentIds };
  const conversationId = await startConversation({
    admin,
    channel: "whatsapp",
    feature: "parent",
    actorId: null,
    actorRole: "parent",
    parentId: sender.parentId,
    scope,
    model: AI_MODELS.parent,
    academicYearId: year.id as string,
  });

  const ctx: CallerContext = {
    channel: "whatsapp",
    role: "parent",
    // No Supabase session on this channel — identity is the enrolled number.
    userId: null,
    parentId: sender.parentId,
    teacherId: null,
    scope,
    allowSensitive: false,
    sessionId: year.id as string,
    admin,
    conversationId,
  };

  // No history: each message is answered on its own. Threading a conversation
  // across an unauthenticated channel would mean trusting a phone number to
  // still be the same person several messages later.
  const result = await runParentTurn(
    ctx,
    buildParentSystemPrompt({ school, childNames }),
    [],
    text,
    childNames
  );

  await reply(admin, phone, result.text, sender.parentId, conversationId);
}

/** Send a free-form reply inside the 24-hour window, and log it. */
async function reply(
  admin: ReturnType<typeof createAdminClient>,
  phone: string,
  body: string,
  parentId: string | null,
  conversationId?: string | null
): Promise<void> {
  // Audit before dispatch, matching the telephony route: a send that throws
  // still leaves a trace that we tried.
  const { data: row } = await admin
    .from("whatsapp_messages")
    .insert({
      direction: "outbound",
      parent_id: parentId,
      phone_last4: phoneLast4(phone),
      category: "service",
      status: "queued",
      conversation_id: conversationId ?? null,
    })
    .select("id")
    .single();

  try {
    const sent = await sendText(phone, body);
    await admin
      .from("whatsapp_messages")
      .update({ wa_message_id: sent.waMessageId, status: "sent" })
      .eq("id", row!.id as string);
  } catch (err) {
    console.error("[whatsapp] send failed:", err);
    await admin
      .from("whatsapp_messages")
      .update({ status: "failed", error_code: String(err).slice(0, 200) })
      .eq("id", row!.id as string);
  }
}
