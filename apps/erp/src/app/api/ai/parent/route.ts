import { NextRequest, NextResponse } from "next/server";
import type Anthropic from "@anthropic-ai/sdk";
import { verifyPortalUser } from "@nkps/shared/lib/verify-portal";
import { getSchoolProfile } from "@nkps/shared/lib/school-profile";
import { rateLimit } from "@nkps/shared/lib/rate-limit";
import { isAiConfigured, AI_MODELS } from "@/lib/ai/client";
import { startConversation } from "@/lib/ai/audit";
import { runParentTurn, buildParentSystemPrompt } from "@/lib/ai/parent-runner";
import type { CallerContext, RowScope } from "@/lib/ai/caller-context";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * POST /api/ai/parent — the parent assistant, in the portal.
 *
 * This is the same assistant WhatsApp will front. Building the authenticated
 * web channel first is deliberate: it exercises the tool set, the scoping and
 * the audit trail against a caller whose identity Supabase has already proven,
 * before any of it is exposed to an unauthenticated ingress where the only
 * credential is a phone number.
 *
 * Scope comes from verifyPortalUser(), which re-resolves the caller's wards
 * from student_parents on every request. It is never cached in the
 * conversation and never taken from the request body.
 */
export async function POST(request: NextRequest) {
  if (!isAiConfigured()) {
    return NextResponse.json(
      { error: "The assistant is not configured.", code: "NOT_CONFIGURED" },
      { status: 503 }
    );
  }

  const portal = await verifyPortalUser({ allow: ["parent", "student"] });
  if (!portal) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const limit = rateLimit({
    name: "ai:parent",
    key: portal.userId,
    max: 15,
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

  let body: { message?: unknown; history?: unknown };
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
    return NextResponse.json({ error: "That message is too long." }, { status: 400 });
  }

  const { admin } = portal;

  if (portal.studentIds.length === 0) {
    return NextResponse.json(
      {
        reply:
          "I can't find a student linked to your account for this session. Please contact the school office.",
      },
      { status: 200 }
    );
  }

  const { data: session } = await admin
    .from("academic_years")
    .select("id")
    .eq("is_current", true)
    .limit(1)
    .maybeSingle();

  if (!session?.id) {
    return NextResponse.json(
      { reply: "The school hasn't opened the new session yet. Please contact the office." },
      { status: 200 }
    );
  }

  const school = await getSchoolProfile(admin);
  if (!school.aiEnabled) {
    return NextResponse.json(
      { error: "The assistant is switched off for this school.", code: "AI_DISABLED" },
      { status: 503 }
    );
  }

  // Names for the prompt. Ids stay server-side; the model addresses children by
  // name and passes ids back only from get_my_children.
  const { data: children } = await admin
    .from("students")
    .select("id, full_name")
    .in("id", portal.studentIds);
  const childNames = (children ?? []).map((c) => c.full_name as string);

  const scope: RowScope = { kind: "students", studentIds: portal.studentIds };

  const conversationId = await startConversation({
    admin,
    channel: "portal_web",
    feature: "parent",
    actorId: portal.userId,
    actorRole: portal.role,
    parentId: portal.parentId,
    scope,
    model: AI_MODELS.parent,
    academicYearId: session.id as string,
  });

  const ctx: CallerContext = {
    channel: "portal_web",
    role: portal.role,
    userId: portal.userId,
    parentId: portal.parentId,
    teacherId: null,
    scope,
    // Parents never see the sensitive column set. There is no UI to enable it
    // and no body field that could.
    allowSensitive: false,
    sessionId: session.id as string,
    admin,
    conversationId,
  };

  try {
    const result = await runParentTurn(
      ctx,
      buildParentSystemPrompt({ school, childNames }),
      normaliseHistory(body.history),
      message,
      childNames
    );
    return NextResponse.json({ reply: result.text, stopped_by: result.stoppedBy });
  } catch (err) {
    console.error("[ai.parent] turn failed:", err);
    return NextResponse.json(
      {
        reply: `Sorry, something went wrong. Please call the school office${
          school.phones[0] ? ` on ${school.phones[0]}` : ""
        }.`,
      },
      { status: 200 }
    );
  }
}

/** Text-only prior turns. See the note on the ask route: client-supplied tool
 *  results would let the browser feed the model fabricated data. */
function normaliseHistory(raw: unknown): Anthropic.MessageParam[] {
  if (!Array.isArray(raw)) return [];
  const out: Anthropic.MessageParam[] = [];
  for (const entry of raw.slice(-6)) {
    if (!entry || typeof entry !== "object") continue;
    const { role, content } = entry as { role?: unknown; content?: unknown };
    if (role !== "user" && role !== "assistant") continue;
    if (typeof content !== "string" || !content.trim()) continue;
    out.push({ role, content: content.slice(0, 2000) });
  }
  return out;
}
