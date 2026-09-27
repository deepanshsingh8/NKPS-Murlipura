import type Anthropic from "@anthropic-ai/sdk";
import { getAiClient, AI_MODELS, AI_EFFORT, AI_BUDGETS, AI_MAX_TOKENS } from "./client";
import type { CallerContext } from "./caller-context";
import { recordMessage, finishConversation, nextMessageSeq } from "./audit";
import { renderToolError, isRecoverable } from "./tool-errors";
import { executeParentTool } from "./tools/parent";
import type { SchoolProfile } from "@nkps/shared/lib/school-profile";

/**
 * The parent assistant loop.
 *
 * Separate from the Ask-your-school runner rather than parameterised, because
 * the two differ in every way that matters: a different tool set, a different
 * scope model, a different cache prefix, a different tolerance for length, and
 * a different failure posture. Sharing one loop would mean a conditional at
 * every one of those points, and a mistake in any of them would leak across
 * two audiences with very different entitlements.
 */

const PARENT_TOOLS: Anthropic.Tool[] = [
  {
    name: "get_my_children",
    description:
      "The children linked to this parent, with class and roll number. Call this first when the parent has more than one child and has not said which.",
    input_schema: { type: "object", properties: {}, additionalProperties: false, required: [] },
    strict: true,
  },
  {
    name: "get_child_attendance",
    description:
      "Attendance summary for one child this session. percent is null when nothing has been marked yet — say so rather than reporting 0%.",
    input_schema: {
      type: "object",
      properties: {
        student_id: { type: "string" },
        from: { type: "string", description: "YYYY-MM-DD, optional" },
        to: { type: "string", description: "YYYY-MM-DD, optional" },
      },
      additionalProperties: false,
      required: ["student_id"],
    },
    strict: true,
  },
  {
    name: "get_child_fees",
    description: "Outstanding fee balance for one child, as recorded by the office.",
    input_schema: {
      type: "object",
      properties: { student_id: { type: "string" } },
      additionalProperties: false,
      required: ["student_id"],
    },
    strict: true,
  },
  {
    name: "get_child_results",
    description:
      "PUBLISHED results only. Returns published:false when the school has not released them yet.",
    input_schema: {
      type: "object",
      properties: { student_id: { type: "string" } },
      additionalProperties: false,
      required: ["student_id"],
    },
    strict: true,
  },
  {
    name: "get_child_timetable",
    description: "Class timetable. day_of_week is 1=Monday through 6=Saturday.",
    input_schema: {
      type: "object",
      properties: {
        student_id: { type: "string" },
        weekday: { type: "number", description: "1-6, optional" },
      },
      additionalProperties: false,
      required: ["student_id"],
    },
    strict: true,
  },
  {
    name: "get_child_ptm_notes",
    description: "The five most recent parent-teacher meeting notes for one child.",
    input_schema: {
      type: "object",
      properties: { student_id: { type: "string" } },
      additionalProperties: false,
      required: ["student_id"],
    },
    strict: true,
  },
  {
    name: "get_school_calendar",
    description: "Upcoming school-wide events, holidays and exams.",
    input_schema: {
      type: "object",
      properties: { from: { type: "string", description: "YYYY-MM-DD, optional" } },
      additionalProperties: false,
      required: [],
    },
    strict: true,
  },
];

export interface ParentPromptInput {
  school: SchoolProfile;
  /** Names only — never ids. The model addresses children by name. */
  childNames: string[];
}

/**
 * Cache-stable per school, not per parent.
 *
 * The child names are the one volatile part, so they go in the user turn
 * rather than here — otherwise every parent would have their own cache prefix
 * and the cache would never hit.
 */
export function buildParentSystemPrompt(input: ParentPromptInput): string {
  const languages = input.school.aiLanguages.includes("hi")
    ? "Reply in the language the parent writes in. If they write in Hindi or Hinglish, reply the same way."
    : "Reply in English.";

  return `You are the parent helpdesk for ${input.school.name}. You answer parents' questions about their own children — attendance, fees, results, timetable, PTM notes and school dates.

## Rules

- You can only see this parent's own children. If they ask about any other child, say you can only help with their own — do not speculate about whether that child exists.
- Every number you give must come from a tool result. Never estimate, never round for effect, never fill a gap with a plausible figure.
- If a tool says results are not published, say the school has not released them yet. Do not imply you know the marks.
- If attendance percent is null, say attendance has not been marked yet. Do not say 0%.
- For anything you cannot answer — a fee dispute, a leave application, a complaint, a transfer, anything needing a decision — give the school office's number and stop. Do not promise the school will do something.
- Never give medical, legal or academic-placement advice.
- Never share another family's information, and never repeat one child's details when asked about a sibling.

## Style

Short. Two or three sentences is usually right; this is a chat, not a letter. Warm and plain — you are talking to a parent, often on a phone, often in a hurry. Use the child's first name. ${languages}

Use Indian conventions: ₹ for money, DD/MM for dates, "Class VIII" not "Grade 8".

## The school

${input.school.name}${input.school.addressFull ? `, ${input.school.addressFull}` : ""}
Office: ${input.school.phones.join(" / ") || "see the school website"}${input.school.officeHours ? ` · ${input.school.officeHours}` : ""}

${input.school.aiDisclaimer ?? ""}`.trim();
}

export interface ParentTurnResult {
  text: string;
  toolCalls: number;
  stoppedBy: "end_turn" | "budget" | "error";
}

export async function runParentTurn(
  ctx: CallerContext,
  systemPrompt: string,
  history: Anthropic.MessageParam[],
  userMessage: string,
  childNames: string[]
): Promise<ParentTurnResult> {
  const client = getAiClient();
  const deadline = Date.now() + AI_BUDGETS.maxWallClockMs;

  // Child names ride in the user turn, after the cache breakpoint, so the
  // system prefix stays identical for every parent in the school.
  const messages: Anthropic.MessageParam[] = [
    ...history,
    {
      role: "user",
      content: `[Children linked to this parent: ${childNames.join(", ") || "none"}]\n\n${userMessage}`,
    },
  ];

  // Never history.length: see nextMessageSeq for why the client's idea of
  // history cannot be trusted to produce a unique sequence.
  let seq = await nextMessageSeq(ctx.admin, ctx.conversationId);
  await recordMessage({
    admin: ctx.admin,
    conversationId: ctx.conversationId,
    seq,
    role: "user",
    content: userMessage,
  });

  let toolCalls = 0;
  const retries = new Map<string, number>();

  for (;;) {
    if (Date.now() > deadline || toolCalls >= AI_BUDGETS.maxToolCalls) {
      await finishConversation(ctx.admin, ctx.conversationId, "aborted", "budget_exhausted");
      return {
        text: "Sorry, I couldn't finish that one. Please call the school office.",
        toolCalls,
        stoppedBy: "budget",
      };
    }

    const startedAt = Date.now();
    let response: Anthropic.Message;
    try {
      response = await client.messages.create({
        model: AI_MODELS.parent,
        max_tokens: AI_MAX_TOKENS,
        thinking: { type: "adaptive" },
        // Low effort on purpose: the questions are narrow lookups, and the
        // hard part (deciding whose data may be read) happened on the server
        // before the model ran.
        output_config: { effort: AI_EFFORT.parent },
        system: [
          { type: "text", text: systemPrompt, cache_control: { type: "ephemeral" } },
        ],
        tools: PARENT_TOOLS,
        messages,
      });
    } catch (err) {
      console.error("[ai.parent] model call failed:", err);
      await finishConversation(ctx.admin, ctx.conversationId, "error", "model_error");
      return {
        text: "Sorry, I can't answer right now. Please call the school office.",
        toolCalls,
        stoppedBy: "error",
      };
    }

    seq += 1;
    await recordMessage({
      admin: ctx.admin,
      conversationId: ctx.conversationId,
      seq,
      role: "assistant",
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
      // Joined with a BLANK line, not a single newline.
      //
      // A reply can arrive as several text blocks — thinking and text
      // interleave once tools are in play. Markdown block elements need a
      // blank line to start: glue two blocks together with one newline and a
      // table or list opening the second block is absorbed into the last
      // paragraph of the first, and renders as literal pipe characters.
      const text = response.content
        .filter((b): b is Anthropic.TextBlock => b.type === "text")
        .map((b) => b.text.trim())
        .filter(Boolean)
        .join("\n\n")
        .trim();
      await finishConversation(ctx.admin, ctx.conversationId, "completed");
      return { text, toolCalls, stoppedBy: "end_turn" };
    }

    const results = await Promise.all(
      toolUses.map(async (use) => {
        toolCalls += 1;
        const outcome = await executeParentTool(
          ctx,
          use.name,
          (use.input ?? {}) as Record<string, unknown>,
          seq
        );

        if (!outcome.ok) {
          const attempts = (retries.get(use.name) ?? 0) + 1;
          retries.set(use.name, attempts);
          const exhausted =
            !isRecoverable(outcome.error.code) || attempts > AI_BUDGETS.maxToolRetries;
          return {
            type: "tool_result" as const,
            tool_use_id: use.id,
            is_error: true,
            content: exhausted
              ? `${renderToolError(outcome.error)}\nDo not try again. Tell the parent plainly.`
              : renderToolError(outcome.error),
          };
        }

        return {
          type: "tool_result" as const,
          tool_use_id: use.id,
          content: JSON.stringify(outcome.data),
        };
      })
    );

    messages.push({ role: "user", content: results });
  }
}
