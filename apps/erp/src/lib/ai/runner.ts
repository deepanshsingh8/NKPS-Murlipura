import type Anthropic from "@anthropic-ai/sdk";
import { getAiClient, AI_MODELS, AI_EFFORT, AI_BUDGETS, AI_MAX_TOKENS } from "./client";
import type { CallerContext } from "./caller-context";
import {
  recordMessage,
  recordToolCall,
  recordTurnFailure,
  touchConversation,
  finishConversation,
  nextMessageSeq,
} from "./audit";
import { isRecoverable, renderToolError, type ToolErrorCode } from "./tool-errors";
import { executeRunStudentReport } from "./tools/report";
import {
  executeListClasses,
  executeListExamTypes,
  executeListAcademicSessions,
  executeListLookupValues,
  type LookupKind,
} from "./tools/lookups";

/**
 * The agentic loop for Ask-your-school.
 *
 * Written by hand rather than with the SDK's tool runner because three things
 * here are not optional and all of them live inside the loop: a wall-clock and
 * tool-call budget, an audit row per tool call written before execution, and a
 * per-tool retry cap keyed on whether the error is recoverable at all. A
 * scope violation must not become a retry loop against the same wall.
 */

const TOOL_DEFINITIONS: Anthropic.Tool[] = [
  {
    name: "run_student_report",
    description:
      "Run a student report and get back counts, optional group rollups, and a small preview. Use group_by for questions about totals or distributions rather than requesting more preview rows.",
    input_schema: {
      type: "object",
      properties: {
        filters: {
          type: "object",
          description:
            "Filter object. Omit session_id unless the user asked about a past year. class_ids, stream_id, house_id and subject_id are uuids — look them up first.",
        },
        preview_rows: {
          type: "number",
          description: "Rows to show (0-25, default 10). Not the full result.",
        },
        group_by: {
          type: "array",
          items: { type: "string" },
          description:
            "Up to 2 column keys to count by. The cheap way to answer 'how many per class'.",
        },
        purpose: {
          type: "string",
          description: "One line: what the user actually asked for. Logged.",
        },
      },
      required: ["filters", "purpose"],
    },
  },
  {
    name: "list_classes",
    description: "Classes in the current session that you may query, with their ids.",
    input_schema: { type: "object", properties: {}, additionalProperties: false, required: [] },
    strict: true,
  },
  {
    name: "list_exam_types",
    description: "Exam types in the current session, with their ids.",
    input_schema: { type: "object", properties: {}, additionalProperties: false, required: [] },
    strict: true,
  },
  {
    name: "list_academic_sessions",
    description: "All academic sessions, newest first, flagging the current one.",
    input_schema: { type: "object", properties: {}, additionalProperties: false, required: [] },
    strict: true,
  },
  {
    name: "list_lookup_values",
    description:
      "The values actually present for a filter that matches free text or ids. Call this before filtering on gender, category, religion, minority_group or area_type.",
    input_schema: {
      type: "object",
      properties: {
        kind: {
          type: "string",
          enum: [
            "stream", "house", "subject",
            "category", "religion", "gender", "area_type", "minority_group",
          ],
        },
      },
      additionalProperties: false,
      required: ["kind"],
    },
    strict: true,
  },
];

/** One `run_student_report` call the model made, in the order it made them. */
export interface AskRun {
  runId: string;
  /** The model's own stated intent, verbatim. Labels the table in the UI. */
  purpose: string;
  total: number;
}

/**
 * What the browser is told as a turn happens.
 *
 * The turn used to be one 45-second silence followed by a paragraph. Streaming
 * buys three things, in this order of value: a Stop button that actually stops
 * work on the SERVER rather than only hiding the result, progressive text, and
 * an honest answer to "why is this taking so long".
 */
export type AskEvent =
  /**
   * Sent before the model runs, so a chat that is stopped one second in still
   * knows its own id and the next message appends instead of starting over.
   */
  | { type: "start"; conversationId: string | null }
  /** Text as the model writes it. Only text — thinking deltas never leave. */
  | { type: "delta"; text: string }
  /**
   * A round finished. `hadTools` means the text just streamed was a preamble
   * ("Let me check the class list…"), not the answer — the client moves it to
   * the progress line and starts the answer buffer over. Without this the live
   * view would show preamble plus answer while a reload showed only the
   * answer, and the same turn would read differently depending on when you
   * looked at it.
   */
  | { type: "round_end"; hadTools: boolean }
  | { type: "tool_start"; name: string; label: string | null }
  | { type: "tool_done"; name: string; failed: boolean }
  | {
      type: "done";
      text: string;
      runs: AskRun[];
      conversationId: string | null;
      stoppedBy: "end_turn" | "budget" | "error";
    };

/**
 * Run one turn, reporting as it goes.
 *
 * `question` is what the human typed; `contextBlock` is what the server adds
 * for the model's benefit (the current session name). They are separate
 * parameters because they have different destinations: the model sees both,
 * the audit trail sees only the question. Before this they were concatenated
 * by the caller, so every stored user message began with a sentence the server
 * wrote and the transcript attributed it to the user.
 *
 * `signal` is the request's own. When the user hits Stop the browser drops the
 * connection, Next aborts the request, and that abort reaches the model call —
 * so the completion is genuinely cancelled rather than merely ignored. Before
 * this, a stopped turn still paid for every token it was going to produce.
 */
export async function* runAskTurn(
  ctx: CallerContext,
  systemPrompt: string,
  history: Anthropic.MessageParam[],
  question: string,
  contextBlock?: string,
  signal?: AbortSignal
): AsyncGenerator<AskEvent, void, void> {
  const client = getAiClient();
  const deadline = Date.now() + AI_BUDGETS.maxWallClockMs;

  const modelText = contextBlock ? `${contextBlock}\n\n${question}` : question;
  const messages: Anthropic.MessageParam[] = [
    ...history,
    { role: "user", content: modelText },
  ];

  // Never history.length: see nextMessageSeq for why the client's idea of
  // history cannot be trusted to produce a unique sequence.
  let seq = await nextMessageSeq(ctx.admin, ctx.conversationId);
  await touchConversation(ctx.admin, ctx.conversationId);
  await recordMessage({
    admin: ctx.admin,
    conversationId: ctx.conversationId,
    seq,
    role: "user",
    content: question,
  });

  let toolCalls = 0;
  const runs: AskRun[] = [];
  const retries = new Map<string, number>();

  for (;;) {
    // Checked at the top of every round, not only inside the model call: a
    // turn aborted while its tools are running must not start another round.
    if (signal?.aborted) {
      await recordTurnFailure({
        admin: ctx.admin,
        conversationId: ctx.conversationId,
        seq: seq + 1,
        content: "Stopped.",
        errorCode: "user_stopped",
      });
      await finishConversation(ctx.admin, ctx.conversationId, "aborted", "user_stopped");
      return;
    }

    if (Date.now() > deadline || toolCalls >= AI_BUDGETS.maxToolCalls) {
      const text =
        runs.length > 0
          ? "That took longer than I allow for one question. I've kept the results I did get — try narrowing the question."
          : "That took longer than I allow for one question. Try asking for something narrower.";
      // Store the sentence the user actually saw, so a reopened chat reads
      // back as it happened rather than as a question with no answer.
      await recordTurnFailure({
        admin: ctx.admin,
        conversationId: ctx.conversationId,
        seq: seq + 1,
        content: text,
        errorCode: "budget_exhausted",
      });
      await finishConversation(ctx.admin, ctx.conversationId, "aborted", "budget_exhausted");
      yield {
        type: "done",
        text,
        runs,
        conversationId: ctx.conversationId,
        stoppedBy: "budget",
      };
      return;
    }

    const startedAt = Date.now();
    let response: Anthropic.Message;
    try {
      const stream = client.messages.stream(
        {
          model: AI_MODELS.ask,
          max_tokens: AI_MAX_TOKENS,
          thinking: { type: "adaptive" },
          output_config: { effort: AI_EFFORT.ask },
          // Cache the stable prefix: tool definitions and the system prompt.
          // Everything volatile is in `messages`, after this breakpoint.
          system: [
            { type: "text", text: systemPrompt, cache_control: { type: "ephemeral" } },
          ],
          tools: TOOL_DEFINITIONS,
          messages,
        },
        { signal }
      );

      for await (const event of stream) {
        // text_delta ONLY. thinking_delta is the model's private reasoning and
        // must never reach a school office screen.
        if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
          yield { type: "delta", text: event.delta.text };
        }
      }

      response = await stream.finalMessage();
    } catch (err) {
      // An abort is the user's doing, not a failure to report as one — and it
      // arrives here as a thrown error because that is how a cancelled fetch
      // surfaces.
      if (signal?.aborted) {
        await recordTurnFailure({
          admin: ctx.admin,
          conversationId: ctx.conversationId,
          seq: seq + 1,
          content: "Stopped.",
          errorCode: "user_stopped",
        });
        await finishConversation(ctx.admin, ctx.conversationId, "aborted", "user_stopped");
        return;
      }

      console.error("[ai.runner] model call failed:", err);
      const text =
        "I couldn't reach the assistant just now. The report builder under Reports still works.";
      await recordTurnFailure({
        admin: ctx.admin,
        conversationId: ctx.conversationId,
        seq: seq + 1,
        content: text,
        errorCode: "model_error",
      });
      await finishConversation(ctx.admin, ctx.conversationId, "error", "model_error");
      yield {
        type: "done",
        text,
        runs,
        conversationId: ctx.conversationId,
        stoppedBy: "error",
      };
      return;
    }

    // Joined with a BLANK line, not a single newline.
    //
    // A reply can arrive as several text blocks — thinking and text interleave
    // once tools are in play. Markdown block elements need a blank line to
    // start: glue two blocks together with one newline and a table or list
    // opening the second block is absorbed into the last paragraph of the
    // first, and renders as literal pipe characters.
    const replyText = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text.trim())
      .filter(Boolean)
      .join("\n\n")
      .trim();

    seq += 1;
    await recordMessage({
      admin: ctx.admin,
      conversationId: ctx.conversationId,
      seq,
      role: "assistant",
      // Stored on EVERY round, including the tool-use preambles nobody sees.
      // stop_reason already separates them: the visible answer is the row
      // where it is not 'tool_use', and rebuilding history skips the rest.
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
      (block): block is Anthropic.ToolUseBlock => block.type === "tool_use"
    );

    yield { type: "round_end", hadTools: toolUses.length > 0 };

    if (toolUses.length === 0) {
      await finishConversation(ctx.admin, ctx.conversationId, "completed");
      yield {
        type: "done",
        text: replyText,
        runs,
        conversationId: ctx.conversationId,
        stoppedBy: "end_turn",
      };
      return;
    }

    // Announce all of them before any of them run. They execute in parallel,
    // so reporting them one at a time would misrepresent the order and hide
    // the fact that two lookups are in flight at once.
    for (const use of toolUses) {
      yield { type: "tool_start", name: use.name, label: toolLabel(use) };
    }

    // Execute in parallel, then return EVERY result in one user message.
    // Splitting them across messages teaches the model to stop making parallel
    // calls, and dropping a failed one leaves a dangling tool_use.
    const settled = await Promise.all(
      toolUses.map(async (use) => {
        toolCalls += 1;
        const outcome = await executeTool(ctx, use, seq);

        if (!outcome.ok) {
          const attempts = (retries.get(use.name) ?? 0) + 1;
          retries.set(use.name, attempts);
          const exhausted =
            !isRecoverable(outcome.code) || attempts > AI_BUDGETS.maxToolRetries;
          return {
            block: {
              type: "tool_result" as const,
              tool_use_id: use.id,
              is_error: true,
              content: exhausted
                ? `${outcome.body}\nNo further attempts. Explain this to the user.`
                : outcome.body,
            },
            run: null,
            name: use.name,
            failed: true,
          };
        }

        return {
          block: {
            type: "tool_result" as const,
            tool_use_id: use.id,
            content: outcome.body,
          },
          run: outcome.run ?? null,
          name: use.name,
          failed: false,
        };
      })
    );

    // Promise.all preserves the ARRAY order, so runs are appended in the order
    // the model asked for them rather than the order they happened to finish.
    for (const { run } of settled) if (run) runs.push(run);
    for (const { name, failed } of settled) {
      yield { type: "tool_done", name, failed };
    }

    messages.push({ role: "user", content: settled.map((r) => r.block) });
  }
}

/**
 * A human label for a tool call in flight.
 *
 * `purpose` is required on run_student_report and already logged verbatim, so
 * the progress line can read "Running report: students without transport"
 * instead of a tool name nobody outside this codebase recognises.
 */
function toolLabel(use: Anthropic.ToolUseBlock): string | null {
  const input = use.input as Record<string, unknown>;
  const purpose = typeof input.purpose === "string" ? input.purpose.trim() : "";
  if (purpose) return purpose;
  if (use.name === "list_lookup_values" && typeof input.kind === "string") {
    return input.kind;
  }
  return null;
}

type ToolOutcome =
  | { ok: true; body: string; run?: AskRun | null }
  | { ok: false; code: ToolErrorCode; body: string };

async function executeTool(
  ctx: CallerContext,
  use: Anthropic.ToolUseBlock,
  messageSeq: number
): Promise<ToolOutcome> {
  // Tool inputs are parsed as JSON by the SDK; never string-match them.
  const input = use.input as Record<string, unknown>;
  const started = Date.now();

  switch (use.name) {
    case "run_student_report": {
      const outcome = await executeRunStudentReport(ctx, input, messageSeq);
      if (!outcome.ok) {
        return {
          ok: false,
          code: outcome.error.code,
          body: renderToolError(outcome.error),
        };
      }
      return {
        ok: true,
        body: JSON.stringify(outcome.result),
        run: outcome.result.run_id
          ? {
              runId: outcome.result.run_id,
              // `purpose` is required on the tool and already logged verbatim;
              // reusing it as the table's label costs nothing and means the
              // chip reads "students without transport" rather than a uuid.
              purpose:
                typeof input.purpose === "string" && input.purpose.trim()
                  ? input.purpose.trim()
                  : "Report",
              total: outcome.result.total,
            }
          : null,
      };
    }

    case "list_classes":
    case "list_exam_types":
    case "list_academic_sessions":
    case "list_lookup_values": {
      const data =
        use.name === "list_classes"
          ? await executeListClasses(ctx)
          : use.name === "list_exam_types"
            ? await executeListExamTypes(ctx)
            : use.name === "list_academic_sessions"
              ? await executeListAcademicSessions(ctx)
              : await executeListLookupValues(ctx, input.kind as LookupKind);

      await recordToolCall({
        admin: ctx.admin,
        conversationId: ctx.conversationId,
        messageSeq,
        toolName: use.name,
        argsRaw: input,
        durationMs: Date.now() - started,
      });
      return { ok: true, body: JSON.stringify(data) };
    }

    default:
      return {
        ok: false,
        code: "query_failed",
        body: `error: unknown tool "${use.name}"`,
      };
  }
}
