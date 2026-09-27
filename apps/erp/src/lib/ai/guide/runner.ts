import type Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  findScreenGuide,
  findWorkflow,
  SCREEN_GUIDES,
  WORKFLOWS,
} from "@nkps/shared/lib/guide/screens";
import { getAiClient, AI_MODELS, AI_EFFORT, AI_BUDGETS } from "../client";
import {
  recordMessage,
  recordToolCall,
  recordTurnFailure,
  touchConversation,
  finishConversation,
  nextMessageSeq,
} from "../audit";

/**
 * The in-app guide's loop.
 *
 * Deliberately much smaller than the Ask runner, and the difference is the
 * point: this surface has exactly ONE tool, and it reads a checked-in
 * TypeScript file. There is no database access, no scoping, no PII gate and no
 * row cap, because there are no rows. That is what lets it be open to every
 * signed-in staff member rather than to holders of a data grant.
 */

export type GuideEvent =
  | { type: "start"; conversationId: string | null }
  | { type: "delta"; text: string }
  | { type: "tool_start"; label: string }
  | { type: "done"; text: string; stoppedBy: "end_turn" | "budget" | "error" };

const GUIDE_TOOLS: Anthropic.Tool[] = [
  {
    name: "get_screen_guide",
    description:
      "The tasks, steps, prerequisites and known gotchas for one ERP screen. " +
      "Call this before describing any screen — it is the only source of truth " +
      "for control labels. Pass a path exactly as it appears in the index.",
    input_schema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: 'Route from the index, e.g. "/people/students".',
        },
      },
      additionalProperties: false,
      required: ["path"],
    },
    strict: true,
  },
  {
    name: "get_workflow",
    description:
      "The ordered steps for a job that spans several screens, or the ranked " +
      "causes of a symptom. Call this FIRST for any setup, rollover or " +
      '"why is this not working" question — the order is the answer, and no ' +
      "single screen entry has it.",
    input_schema: {
      type: "object",
      properties: {
        id: {
          type: "string",
          description: 'Workflow id from the index, e.g. "exam-setup".',
        },
      },
      additionalProperties: false,
      required: ["id"],
    },
    strict: true,
  },
];

/**
 * Room for a real answer.
 *
 * Was 4, which quietly capped the useful case: a symptom question legitimately
 * reads a workflow and then two or three of the screens it names, and running
 * out mid-diagnosis produced exactly the half-answers this surface exists to
 * avoid. Lookups are a local file read — the only cost is a round trip.
 */
const MAX_LOOKUPS = 8;

export async function* runGuideTurn(args: {
  admin: SupabaseClient;
  conversationId: string | null;
  systemPrompt: string;
  history: Anthropic.MessageParam[];
  question: string;
  contextBlock: string;
  signal?: AbortSignal;
}): AsyncGenerator<GuideEvent, void, void> {
  const client = getAiClient();
  const deadline = Date.now() + AI_BUDGETS.maxWallClockMs;

  const messages: Anthropic.MessageParam[] = [
    ...args.history,
    { role: "user", content: `${args.contextBlock}\n\n${args.question}` },
  ];

  let seq = await nextMessageSeq(args.admin, args.conversationId);
  await touchConversation(args.admin, args.conversationId);
  await recordMessage({
    admin: args.admin,
    conversationId: args.conversationId,
    seq,
    role: "user",
    content: args.question,
  });

  let lookups = 0;
  // Set once the lookup budget is spent, so the nudge is added exactly once.
  let forcedFinal = false;

  for (;;) {
    if (args.signal?.aborted) {
      await finishConversation(args.admin, args.conversationId, "aborted", "user_stopped");
      return;
    }

    // Running out of LOOKUPS is not a reason to give up — by that point the
    // model is holding everything it needs and is one round from writing the
    // answer. Abandoning there produced the worst possible outcome: eight
    // successful reads and then "ask about one screen at a time", on exactly
    // the broad questions this surface exists for. So the budget takes the
    // tools away and demands an answer instead of ending the turn.
    const outOfLookups = lookups >= MAX_LOOKUPS;
    if (outOfLookups && !forcedFinal) {
      forcedFinal = true;
      messages.push({
        role: "user",
        content:
          "You have used your lookup budget. Answer now, in full, using what you have already read. Do not mention the budget.",
      });
    }

    // Running out of WALL CLOCK is different — there is no time left to write
    // anything, so this one really does have to stop.
    if (Date.now() > deadline) {
      const text =
        "That took longer than I allow for one question — try asking about one screen at a time.";
      await recordTurnFailure({
        admin: args.admin,
        conversationId: args.conversationId,
        seq: seq + 1,
        content: text,
        errorCode: "budget_exhausted",
      });
      await finishConversation(args.admin, args.conversationId, "aborted", "budget_exhausted");
      yield { type: "done", text, stoppedBy: "budget" };
      return;
    }

    const startedAt = Date.now();
    let response: Anthropic.Message;
    try {
      const stream = client.messages.stream(
        {
          model: AI_MODELS.guide,
          max_tokens: 3000,
          output_config: { effort: AI_EFFORT.guide },
          system: [
            {
              type: "text",
              text: args.systemPrompt,
              cache_control: { type: "ephemeral" },
            },
          ],
          // No tools on the forced round: the instruction above is a
          // request, an empty tool list is a guarantee.
          ...(forcedFinal ? {} : { tools: GUIDE_TOOLS }),
          messages,
        },
        { signal: args.signal }
      );

      for await (const event of stream) {
        if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
          yield { type: "delta", text: event.delta.text };
        }
      }
      response = await stream.finalMessage();
    } catch (err) {
      if (args.signal?.aborted) {
        await finishConversation(args.admin, args.conversationId, "aborted", "user_stopped");
        return;
      }
      console.error("[ai.guide] model call failed:", err);
      const text = "I couldn't reach the guide just now. Try again in a moment.";
      await recordTurnFailure({
        admin: args.admin,
        conversationId: args.conversationId,
        seq: seq + 1,
        content: text,
        errorCode: "model_error",
      });
      await finishConversation(args.admin, args.conversationId, "error", "model_error");
      yield { type: "done", text, stoppedBy: "error" };
      return;
    }

    const replyText = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text.trim())
      .filter(Boolean)
      .join("\n\n")
      .trim();

    seq += 1;
    await recordMessage({
      admin: args.admin,
      conversationId: args.conversationId,
      seq,
      role: "assistant",
      content: replyText || null,
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
      cacheReadTokens: response.usage.cache_read_input_tokens ?? undefined,
      cacheWriteTokens: response.usage.cache_creation_input_tokens ?? undefined,
      stopReason: response.stop_reason,
      latencyMs: Date.now() - startedAt,
    });

    messages.push({ role: "assistant", content: response.content });

    const toolUses = response.content.filter(
      (b): b is Anthropic.ToolUseBlock => b.type === "tool_use"
    );

    if (toolUses.length === 0) {
      await finishConversation(args.admin, args.conversationId, "completed");
      yield { type: "done", text: replyText, stoppedBy: "end_turn" };
      return;
    }

    const results: Anthropic.ToolResultBlockParam[] = [];
    for (const use of toolUses) {
      lookups += 1;
      const input = use.input as { path?: unknown; id?: unknown };

      const found =
        use.name === "get_workflow"
          ? lookupWorkflow(typeof input.id === "string" ? input.id : "")
          : lookupScreen(typeof input.path === "string" ? input.path : "");

      yield { type: "tool_start", label: found.label };

      await recordToolCall({
        admin: args.admin,
        conversationId: args.conversationId,
        messageSeq: seq,
        toolName: use.name,
        argsRaw: input,
        errorCode: found.ok ? null : "not_found",
      });

      results.push({
        type: "tool_result",
        tool_use_id: use.id,
        is_error: !found.ok,
        content: found.body,
      });
    }

    messages.push({ role: "user", content: results });
  }
}

/**
 * Resolve a screen lookup.
 *
 * A miss returns near misses rather than a bare failure — that is what turns a
 * dead end into "did you mean Students?" instead of an apology.
 */
function lookupScreen(path: string): { ok: boolean; label: string; body: string } {
  const guide = findScreenGuide(path);
  if (guide) {
    return { ok: true, label: guide.title, body: JSON.stringify(guide) };
  }
  const prefix = `/${path.split("/")[1] ?? ""}`;
  return {
    ok: false,
    label: path || "an unknown screen",
    body: JSON.stringify({
      error: `No guide for "${path}".`,
      did_you_mean: SCREEN_GUIDES.filter((g) => g.path.startsWith(prefix))
        .slice(0, 5)
        .map((g) => g.path),
    }),
  };
}

function lookupWorkflow(id: string): { ok: boolean; label: string; body: string } {
  const workflow = findWorkflow(id);
  if (workflow) {
    return { ok: true, label: workflow.title, body: JSON.stringify(workflow) };
  }
  return {
    ok: false,
    label: id || "an unknown job",
    body: JSON.stringify({
      error: `No workflow called "${id}".`,
      available: WORKFLOWS.map((w) => w.id),
    }),
  };
}
