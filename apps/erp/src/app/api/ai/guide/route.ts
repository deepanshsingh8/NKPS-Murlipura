import { NextRequest, NextResponse } from "next/server";
import { verifyStaffMember } from "@nkps/shared/lib/verify-admin";
import { getSchoolProfile } from "@nkps/shared/lib/school-profile";
import { rateLimit } from "@nkps/shared/lib/rate-limit";
import { isAiConfigured, AI_MODELS } from "@/lib/ai/client";
import { startConversation } from "@/lib/ai/audit";
import { runGuideTurn } from "@/lib/ai/guide/runner";
import { buildGuideSystemPrompt, buildGuideContext } from "@/lib/ai/guide/prompt";
import { guidePaths } from "@nkps/shared/lib/guide/screens";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * POST /api/ai/guide — "how do I do this?"
 *
 * ── Why this is NOT gated on a feature key ─────────────────────────────────
 * Every other AI route sits behind the grant for the data it reads. This one
 * reads no data: its single tool returns a checked-in TypeScript file
 * describing the software. The people who most need it — a new office clerk,
 * a teacher opening the marks grid for the first time — are exactly the
 * accounts that hold the fewest grants, so gating it on one would withhold it
 * from its own audience.
 *
 * verifyStaffMember is still a real gate: signed in, staff/teacher/admin, and
 * failing closed on a forced password change. It just isn't a data gate,
 * because there is no data behind it.
 */
export async function POST(request: NextRequest) {
  if (!isAiConfigured()) {
    return NextResponse.json(
      { error: "The assistant is not configured on this deployment.", code: "NOT_CONFIGURED" },
      { status: 503 }
    );
  }

  const caller = await verifyStaffMember();
  if (!caller) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { admin, user, role } = caller;

  const limit = rateLimit({
    name: "ai-guide",
    key: user.id,
    max: 30,
    windowSeconds: 60,
  });
  if (!limit.ok) {
    return NextResponse.json(
      { error: `Slow down a moment — try again in ${limit.resetSeconds}s.`, code: "RATE_LIMITED" },
      { status: 429 }
    );
  }

  let body: {
    message?: unknown;
    pathname?: unknown;
    history?: unknown;
    visited?: unknown;
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
  if (message.length > 1000) {
    return NextResponse.json({ error: "That question is too long." }, { status: 400 });
  }

  // The page the user is looking at, so "how do I add one?" resolves against
  // it. Validated against the registry rather than trusted: it arrives from
  // the browser and lands in a prompt.
  const raw = typeof body.pathname === "string" ? body.pathname.split("?")[0] : "/";
  const pathname = guidePaths().some((p) => raw === p || raw.startsWith(`${p}/`))
    ? raw.slice(0, 200)
    : "/";

  // Every screen validated the same way as the current one — it is browser
  // input that lands in a prompt.
  const known = guidePaths();
  const visited = (Array.isArray(body.visited) ? body.visited : [])
    .slice(-8)
    .filter((v): v is string => typeof v === "string")
    .map((v) => v.split("?")[0])
    .filter((v) => known.some((p) => v === p || v.startsWith(`${p}/`)));

  const school = await getSchoolProfile(admin);
  if (!school.aiEnabled) {
    return NextResponse.json(
      { error: "The assistant is switched off for this school.", code: "AI_DISABLED" },
      { status: 503 }
    );
  }

  // What this account can actually open, so the guide never walks someone
  // through a screen the middleware will bounce them from.
  const { data: grants } = await admin
    .from("editor_permissions")
    .select("feature_key")
    .eq("editor_id", user.id);
  const features = (grants ?? []).map((g) => g.feature_key as string);

  const conversationId = await startConversation({
    admin,
    channel: "erp_web",
    feature: "guide",
    actorId: user.id,
    actorRole: role,
    // Literally no student rows. The scope columns are NOT NULL, and an empty
    // student list is the honest value for a surface with no data tools —
    // rather than borrowing {kind:"all"} from Ask and overstating its reach.
    scope: { kind: "students", studentIds: [] },
    model: AI_MODELS.guide,
    academicYearId: null,
    title: message.slice(0, 60),
  });

  const encoder = new TextEncoder();
  let closed = false;

  const sse = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: unknown) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        } catch {
          closed = true;
        }
      };

      send({ type: "start", conversation_id: conversationId });

      try {
        for await (const event of runGuideTurn({
          admin,
          conversationId,
          systemPrompt: buildGuideSystemPrompt(school),
          history: normaliseGuideHistory(body.history),
          question: message,
          contextBlock: buildGuideContext({ pathname, role, features, visited }),
          signal: request.signal,
        })) {
          send(event);
        }
      } catch (err) {
        console.error("[ai.guide] turn failed:", err);
        send({
          type: "done",
          text: "Something went wrong. Try asking again.",
          stoppedBy: "error",
        });
      } finally {
        closed = true;
        controller.close();
      }
    },
  });

  return new Response(sse, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-store, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}

/**
 * The guide panel is ephemeral, so its history comes from the browser.
 *
 * That is acceptable here in a way it is not for Ask: the worst a fabricated
 * prior turn can achieve is a confused answer about a screen, because there is
 * no tool behind this surface that reaches anything. Alternation is still
 * enforced.
 */
function normaliseGuideHistory(
  raw: unknown
): { role: "user" | "assistant"; content: string }[] {
  if (!Array.isArray(raw)) return [];
  const out: { role: "user" | "assistant"; content: string }[] = [];
  // Sixteen, not six. A journey — add the fee structure, find the student,
  // take the payment, check their record — is four exchanges before anyone has
  // gone off-topic, and a three-turn window drops the beginning of it while the
  // user is still in the middle. This history is short text with no tool
  // blocks, so the cost of remembering it is small.
  for (const entry of raw.slice(-16)) {
    if (!entry || typeof entry !== "object") continue;
    const { role, content } = entry as { role?: unknown; content?: unknown };
    if (role !== "user" && role !== "assistant") continue;
    if (typeof content !== "string" || !content.trim()) continue;
    const previous = out[out.length - 1];
    if (!previous) {
      if (role !== "user") continue;
    } else if (previous.role === role) {
      if (role === "user") out.pop();
      else continue;
    }
    out.push({ role, content: content.slice(0, 2000) });
  }
  if (out[out.length - 1]?.role === "user") out.pop();
  return out;
}
