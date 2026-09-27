import { NextRequest, NextResponse, after } from "next/server";
import type Anthropic from "@anthropic-ai/sdk";
import { verifyAdminOrEditorWithUser } from "@nkps/shared/lib/verify-admin";
import { getSchoolProfile } from "@nkps/shared/lib/school-profile";
import { rateLimit } from "@nkps/shared/lib/rate-limit";
import { isAiConfigured, AI_MODELS } from "@/lib/ai/client";
import { startConversation } from "@/lib/ai/audit";
import {
  loadOwnedConversation,
  historyFromDb,
  toMessageParams,
} from "@/lib/ai/conversations";
import { fallbackTitle, generateTitle } from "@/lib/ai/title";
import { scopeHash } from "@/lib/ai/caller-context";
import { runAskTurn } from "@/lib/ai/runner";
import { buildAskSystemPrompt, buildAskContextBlock } from "@/lib/ai/prompts/ask";
import type { CallerContext, RowScope } from "@/lib/ai/caller-context";

export const runtime = "nodejs";
// The loop can make several model calls plus database work. Without this the
// platform kills it mid-turn and the user sees a blank failure.
export const maxDuration = 60;

/**
 * POST /api/ai/ask — Ask-your-school.
 *
 * Gated on the existing `reports` feature key rather than an AI-specific one:
 * this reaches exactly the data the report builder reaches, so it must be
 * exactly as privileged. A separate key would be a second, wider door onto the
 * student master wearing a different name.
 */
export async function POST(request: NextRequest) {
  if (!isAiConfigured()) {
    return NextResponse.json(
      {
        error: "The assistant is not configured on this deployment.",
        code: "NOT_CONFIGURED",
      },
      { status: 503 }
    );
  }

  const caller = await verifyAdminOrEditorWithUser("reports");
  if (!caller) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { admin, user, role } = caller;

  // Per-user, not per-IP: this endpoint is authenticated and metered, so the
  // account is the thing worth limiting. Still in-memory and per-process,
  // which is acceptable here precisely because the caller is already
  // authenticated and privileged — the public WhatsApp ingress will need a
  // DB-backed counter instead.
  const limit = rateLimit({
    name: "ai:ask",
    key: user.id,
    max: 20,
    windowSeconds: 300,
  });
  if (!limit.ok) {
    return NextResponse.json(
      {
        error: `You've asked a lot in a short time. Try again in ${limit.resetSeconds}s.`,
        code: "RATE_LIMITED",
      },
      { status: 429 }
    );
  }

  let body: {
    message?: unknown;
    history?: unknown;
    allow_sensitive?: unknown;
    conversation_id?: unknown;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const message = typeof body.message === "string" ? body.message.trim() : "";
  if (!message) {
    return NextResponse.json({ error: "Ask a question first." }, { status: 400 });
  }
  if (message.length > 2000) {
    return NextResponse.json({ error: "That question is too long." }, { status: 400 });
  }

  const { data: session } = await admin
    .from("academic_years")
    .select("id, name")
    .eq("is_current", true)
    .limit(1)
    .maybeSingle();

  if (!session?.id) {
    return NextResponse.json(
      { error: "No current academic session is set, so there is nothing to report on." },
      { status: 409 }
    );
  }

  const isAdmin = role === "admin";

  // Admins and editors holding the `reports` grant both see all classes —
  // matching /reports/students exactly. Teacher scoping arrives with the
  // remarks feature, which is where a narrower scope actually applies.
  const scope: RowScope = { kind: "all" };

  // Sensitive columns require BOTH admin and a deliberate opt-in from the UI.
  // Never a body default, never something the model can set.
  const allowSensitive = isAdmin && body.allow_sensitive === true;

  const school = await getSchoolProfile(admin);

  // The school's own off switch, separate from whether a key is configured.
  // A principal who wants the assistant dark during results week flips one row
  // rather than waiting on a redeploy — and the fallback profile returns false,
  // so an unreadable configuration fails closed rather than open.
  if (!school.aiEnabled) {
    return NextResponse.json(
      {
        error: "The assistant is switched off for this school.",
        code: "AI_DISABLED",
      },
      { status: 503 }
    );
  }

  // ── Which conversation is this ────────────────────────────────────────────
  // With an id we APPEND to an existing chat; without one we open a new one.
  // Two mismatches refuse rather than append, and both are 409 with a code the
  // UI acts on, because silently doing something reasonable is what makes an
  // assistant untrustworthy.
  const requestedId =
    typeof body.conversation_id === "string" ? body.conversation_id : null;

  let conversationId: string | null;
  let isNewConversation = false;

  if (requestedId) {
    const existing = await loadOwnedConversation(admin, requestedId, user.id);
    if (!existing) {
      return NextResponse.json(
        { error: "That chat is no longer available.", code: "NOT_FOUND" },
        { status: 404 }
      );
    }
    if (existing.scope_hash !== scopeHash(scope)) {
      // The caller's entitlement genuinely narrowed since the chat began.
      // Appending would let them inherit the wider context of the earlier
      // turns without ever having been able to ask for it themselves.
      return NextResponse.json(
        { error: "Your access has changed since this chat started.", code: "SCOPE_CHANGED" },
        { status: 409 }
      );
    }
    if (existing.academic_year_id !== session.id) {
      // The school rolled over mid-history. Every figure above this point
      // refers to a different year, and continuing would mix the two inside
      // one answer without saying so.
      return NextResponse.json(
        { error: "This chat is from a previous session.", code: "SESSION_CHANGED" },
        { status: 409 }
      );
    }
    conversationId = requestedId;
  } else {
    conversationId = await startConversation({
      admin,
      channel: "erp_web",
      feature: "ask",
      actorId: user.id,
      actorRole: role,
      scope,
      model: AI_MODELS.ask,
      academicYearId: session.id as string,
      title: fallbackTitle(message),
    });
    isNewConversation = conversationId != null;
  }

  const ctx: CallerContext = {
    channel: "erp_web",
    role: isAdmin ? "admin" : "editor",
    userId: user.id,
    parentId: null,
    teacherId: null,
    scope,
    allowSensitive,
    sessionId: session.id as string,
    admin,
    conversationId,
  };

  const systemPrompt = buildAskSystemPrompt({
    school,
    isAdmin,
    scopeDescription: "every class in the current session",
    allowSensitive,
  });

  // Where the conversation's memory comes from.
  //
  // With an id, from the database — so the browser stops being the source of
  // truth for what was said, and can no longer assert a prior turn that never
  // happened. Without one (a fresh chat, or an edit/regenerate that rewinds
  // the transcript) it still comes from the client, which is exactly why
  // normaliseHistory exists. Both paths go through it: the alternation and
  // length rules apply to database rows just as much, since a turn whose
  // answer failed leaves a question with no reply.
  const history = conversationId
    ? normaliseHistory(
        toMessageParams(await historyFromDb(admin, conversationId, 8))
      )
    : normaliseHistory(body.history);

  // ── Server-Sent Events, not JSON ──────────────────────────────────────────
  // The turn used to be a single silent await of up to 45 seconds. Streaming
  // it changes the error contract: once a byte is flushed there is no status
  // code left to set, so a late failure has to arrive in-band as a `done`
  // event carrying the sentence the user should read.
  const encoder = new TextEncoder();
  let closed = false;

  const sse = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: unknown) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        } catch {
          // The client went away mid-turn. The abort signal below is what
          // actually stops the work; this just stops us shouting into a
          // closed pipe.
          closed = true;
        }
      };

      send({ type: "start", conversation_id: conversationId });

      try {
        for await (const event of runAskTurn(
          ctx,
          systemPrompt,
          history,
          message,
          buildAskContextBlock(session.name as string),
          request.signal
        )) {
          send(
            event.type === "done"
              ? {
                  type: "done",
                  text: event.text,
                  conversation_id: event.conversationId,
                  stopped_by: event.stoppedBy,
                  // Every report the turn ran, in call order. The UI shows the
                  // last by default and labels each with the model's stated
                  // purpose — one run_id could not distinguish "the 198 the
                  // answer is about" from "the 744 it counted to check".
                  runs: event.runs.map((r) => ({
                    run_id: r.runId,
                    purpose: r.purpose,
                    total: r.total,
                  })),
                }
              : event
          );
        }
      } catch (err) {
        console.error("[ai.ask] turn failed:", err);
        send({
          type: "done",
          text: "Something went wrong running that. The report builder under Reports still works.",
          conversation_id: conversationId,
          stopped_by: "error",
          runs: [],
        });
      } finally {
        closed = true;
        controller.close();
      }
    },
  });

  // after(), not a bare `void`: a fire-and-forget promise can be frozen the
  // instant the response finishes, and because nothing awaits it the failure
  // would be completely silent. Only on the first turn — later turns keep the
  // title the chat already has.
  if (isNewConversation && conversationId) {
    const id = conversationId;
    after(() => generateTitle(admin, id, message));
  }

  return new Response(sse, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-store, no-transform",
      Connection: "keep-alive",
      // Nginx and friends buffer proxied responses by default, which turns a
      // stream back into one long silence followed by everything at once.
      "X-Accel-Buffering": "no",
    },
  });
}

/**
 * Accept only well-formed prior turns, and only text.
 *
 * Tool-use blocks are deliberately dropped: replaying a client-supplied
 * tool_use without its matching tool_result would break the conversation, and
 * accepting client-supplied tool *results* would let the browser feed the
 * model fabricated data.
 */
function normaliseHistory(raw: unknown): Anthropic.MessageParam[] {
  if (!Array.isArray(raw)) return [];
  const out: Anthropic.MessageParam[] = [];
  for (const entry of raw.slice(-8)) {
    if (!entry || typeof entry !== "object") continue;
    const { role, content } = entry as { role?: unknown; content?: unknown };
    if (role !== "user" && role !== "assistant") continue;
    if (typeof content !== "string" || !content.trim()) continue;

    // Enforce alternation, starting on the user.
    //
    // The client can legitimately hold a question whose answer never arrived —
    // the user stopped it, or it failed — and that empty assistant turn is
    // dropped by the check above, leaving two user turns adjacent once the new
    // question is appended. Dropping the orphan is right on both counts: the
    // transcript stays well-formed, and a question the assistant never
    // answered is not context, it is a false memory of having been asked.
    const previous = out[out.length - 1];
    if (!previous) {
      if (role !== "user") continue;
    } else if (previous.role === role) {
      if (role === "user") out.pop();
      else continue;
    }

    out.push({ role, content: content.slice(0, 4000) });
  }

  // A trailing user turn would sit directly before the new question.
  if (out[out.length - 1]?.role === "user") out.pop();

  return out;
}
