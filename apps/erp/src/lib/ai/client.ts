// Server-only Anthropic client. The single place in the ERP allowed to import
// @anthropic-ai/sdk.
//
// Structured to match packages/shared/src/lib/telephony/exotel.ts, which is
// the house pattern for an external provider: a private readConfig() that
// returns null when unconfigured, an isXConfigured() predicate callers check
// before offering the feature, and a named throw when someone calls anyway.
//
// SECURITY: reads secrets from process.env and must only ever be imported by
// server code. Nothing here is safe for the browser bundle, and no
// NEXT_PUBLIC_ var is used on purpose — an exposed key is a metered bill.

import Anthropic from "@anthropic-ai/sdk";

interface AiConfig {
  apiKey: string;
}

function readConfig(): AiConfig | null {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;
  return { apiKey };
}

/**
 * True when the assistant can actually run.
 *
 * Check this before rendering any AI affordance. A button that fails on click
 * is worse than no button, and the school must be able to run the ERP with no
 * key configured at all — nothing on the fees, attendance, marks or report
 * card paths may depend on this returning true.
 */
export function isAiConfigured(): boolean {
  return readConfig() !== null;
}

/** Thrown when an AI path is reached with no key. Callers surface it as 503. */
export const AI_NOT_CONFIGURED = "AI_NOT_CONFIGURED";

let cached: Anthropic | null = null;

/**
 * The shared client. Constructed lazily and reused, so the SDK's connection
 * pooling survives across warm invocations.
 */
export function getAiClient(): Anthropic {
  const config = readConfig();
  if (!config) throw new Error(AI_NOT_CONFIGURED);
  if (!cached) cached = new Anthropic({ apiKey: config.apiKey });
  return cached;
}

/**
 * Model selection, in one place so a change is one line.
 *
 * Opus is the default across the board. The instinct to reach for a cheaper
 * model on the parent channel is premature: `effort` below is the lever to
 * pull first, and the metric that matters is cost per *resolved question*, not
 * cost per request — a cheap model that needs three turns to answer a fee
 * query is not cheaper. Revisit with numbers from ai_messages, not intuition.
 *
 * The public website assistant is deliberately not listed here: it stays on
 * Haiku behind its own route until there is a measured comparison.
 *
 * `title` is the one deliberate exception to the paragraph above, and it does
 * not contradict it. That argument is about ANSWERS — a cheap model that needs
 * three turns to resolve a fee query is not cheap. Naming a chat has no tools,
 * no scoping, no follow-up turn and no correctness stake: the worst outcome is
 * a clumsy label on a row the user can rename in one click.
 */
export const AI_MODELS = {
  /** Natural-language reports: filter synthesis, multi-step tool use. */
  ask: "claude-opus-5",
  /** Report-card remarks: one structured call per class. */
  remarks: "claude-opus-5",
  /** Parent replies over WhatsApp: highest volume, shortest answers. */
  parent: "claude-opus-5",
  /** Naming a saved chat. One short call, no tools — see above. */
  title: "claude-haiku-4-5-20251001",
  /**
   * The in-app guide. Opus, not Haiku, despite being the highest-volume
   * surface: its whole job is to be trusted about which button to press, and
   * a guide that confidently names a control that does not exist costs more
   * than the tokens saved. `effort` is the lever here instead.
   */
  guide: "claude-opus-5",
  /**
   * Matching spreadsheet columns to template fields. One structured call over
   * column SHAPES — never values — so the hard part is inference from thin
   * evidence, which is exactly where a capable model earns its keep.
   */
  importMapping: "claude-opus-5",
} as const;

/**
 * Per-surface effort, the primary cost lever.
 *
 * `low` for parent chat — the questions are narrow lookups whose difficulty is
 * in the scoping, which the server does before the model runs. `high` for
 * report filter synthesis, where getting the filter wrong wastes a whole
 * query and the user's trust.
 */
export const AI_EFFORT = {
  ask: "high",
  remarks: "medium",
  parent: "low",
  /**
   * High, not low.
   *
   * "Retrieval plus a short explanation" undersold the job. The questions that
   * matter are diagnostic — "report cards are showing zero" means reading a
   * workflow, then two screens, then working out which of four causes fits
   * what the user actually said. Low effort answered those thinly, which on a
   * help surface is worse than not answering: it reads as authoritative.
   */
  guide: "high",
  /** A wrong mapping writes wrong data into 900 student records. */
  importMapping: "medium",
} as const;

/**
 * Budgets for the agentic loop.
 *
 * Both are enforced in the runner and both are audited. Without them an
 * unbounded self-correction loop is not a bug, it is an invoice.
 */
export const AI_BUDGETS = {
  /** Wall clock for one turn, including tool execution. */
  maxWallClockMs: 45_000,
  /** Tool calls per turn, across all tools. */
  maxToolCalls: 8,
  /** Retries of a single tool after a validation error, per turn. */
  maxToolRetries: 2,
} as const;

/** Non-streaming ceiling. Streaming paths set their own, higher. */
export const AI_MAX_TOKENS = 4096;
