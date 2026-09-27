import type { SupabaseClient } from "@supabase/supabase-js";
import type { CallerContext, RowScope } from "./caller-context";
import { scopeHash } from "./caller-context";

/**
 * Writes the assistant's audit trail.
 *
 * Follows the telephony route's discipline: the row is written BEFORE the
 * thing it describes happens, then updated with the outcome. A crash, a
 * timeout or a killed container still leaves evidence that the call was
 * attempted — which is exactly the case where you most want a record.
 *
 * Nothing here stores query RESULTS. Counts, field keys and filter shapes
 * only — an audit table that copies the rows it audits doubles the blast
 * radius of the thing it exists to protect.
 *
 * Migration 114 qualified that in one place: `ai_messages.content` now holds
 * the assistant's reply as well as the user's question, because a chat you
 * cannot read back is not a chat. Replies quote figures and names, so that
 * column is student data and the table comment says so. Deleting a chat blanks
 * it; the surrounding skeleton — seq, tokens, tool calls, query runs — stays,
 * so a user tidying their history cannot erase what the assistant read.
 */

export interface StartConversationArgs {
  admin: SupabaseClient;
  channel: "erp_web" | "portal_web" | "whatsapp";
  feature: "ask" | "remarks" | "parent" | "guide";
  actorId: string | null;
  actorRole: string;
  parentId?: string | null;
  teacherId?: string | null;
  scope: RowScope;
  model: string;
  academicYearId: string | null;
  /**
   * Written at creation, never left blank.
   *
   * A deterministic title costs nothing and guarantees the chat list can never
   * show an untitled row — which is what would happen if the only titler were
   * the model call, and it failed or was still in flight. The good title
   * overwrites this one later, and only while title_source is still 'auto'.
   */
  title?: string | null;
}

/**
 * Opens a conversation row and returns its id.
 *
 * Returns null rather than throwing when the insert fails: losing the audit
 * trail is bad, but taking down the feature because a log write failed is
 * worse, and the failure is logged to the server console either way. Callers
 * treat a null id as "audit unavailable" and carry on.
 */
export async function startConversation(
  args: StartConversationArgs
): Promise<string | null> {
  const { data, error } = await args.admin
    .from("ai_conversations")
    .insert({
      channel: args.channel,
      feature: args.feature,
      actor_id: args.actorId,
      actor_role: args.actorRole,
      parent_id: args.parentId ?? null,
      teacher_id: args.teacherId ?? null,
      scope_kind: args.scope.kind,
      scope_hash: scopeHash(args.scope),
      model: args.model,
      academic_year_id: args.academicYearId,
      status: "open",
      title: args.title ?? null,
      title_source: args.title ? "auto" : null,
    })
    .select("id")
    .single();

  if (error || !data) {
    console.error("[ai.audit] could not open conversation:", error?.message);
    return null;
  }
  return data.id as string;
}

/**
 * The next free message sequence for a conversation.
 *
 * Derived from the database rather than from `history.length`, because history
 * is what the CLIENT sent — it can be truncated, replayed, or absent on a
 * resumed conversation, and any of those makes seq collide with the
 * (conversation_id, seq) unique constraint. The write then fails and the turn
 * silently loses its audit row.
 *
 * One indexed lookup per turn is a fair price for a trail that cannot skip.
 */
export async function nextMessageSeq(
  admin: SupabaseClient,
  conversationId: string | null
): Promise<number> {
  if (!conversationId) return 1;
  const { data } = await admin
    .from("ai_messages")
    .select("seq")
    .eq("conversation_id", conversationId)
    .order("seq", { ascending: false })
    .limit(1)
    .maybeSingle();
  return ((data?.seq as number | undefined) ?? 0) + 1;
}

export interface RecordMessageArgs {
  admin: SupabaseClient;
  conversationId: string | null;
  seq: number;
  role: "user" | "assistant";
  content?: string | null;
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  stopReason?: string | null;
  latencyMs?: number;
  /** Why this turn produced no answer. Per-turn, not per-conversation. */
  errorCode?: string | null;
}

/** Long enough for any real answer; short enough that one runaway reply
 *  cannot bloat a row without bound. */
const MAX_STORED_CONTENT = 20_000;

/**
 * Write one message row.
 *
 * Retries once at seq + 1 on a unique violation. `nextMessageSeq` reads then
 * writes, so two tabs posting into the same conversation can both compute the
 * same seq; before 114 that was unreachable because the conversation id never
 * left the server, and the only symptom would have been a turn silently losing
 * its audit row. One retry closes the realistic window without pretending to
 * be a lock.
 */
export async function recordMessage(args: RecordMessageArgs): Promise<void> {
  if (!args.conversationId) return;

  const content =
    args.content == null
      ? null
      : args.content.slice(0, MAX_STORED_CONTENT) || null;

  const row = {
    conversation_id: args.conversationId,
    role: args.role,
    content,
    input_tokens: args.inputTokens ?? null,
    output_tokens: args.outputTokens ?? null,
    cache_read_tokens: args.cacheReadTokens ?? null,
    cache_write_tokens: args.cacheWriteTokens ?? null,
    stop_reason: args.stopReason ?? null,
    latency_ms: args.latencyMs ?? null,
    error_code: args.errorCode ?? null,
  };

  const first = await args.admin.from("ai_messages").insert({ ...row, seq: args.seq });
  if (!first.error) return;

  // 23505 = unique_violation.
  if (first.error.code === "23505") {
    const retry = await args.admin
      .from("ai_messages")
      .insert({ ...row, seq: args.seq + 1 });
    if (!retry.error) return;
    console.error("[ai.audit] message (after seq retry):", retry.error.message);
    return;
  }

  console.error("[ai.audit] message:", first.error.message);
}

/**
 * Record that a turn ended without an answer.
 *
 * Without this a reopened chat shows a question above nothing at all, and the
 * user is left to guess whether they stopped it, it failed, or the page ate
 * it. `content` is the same sentence the user actually saw on screen, so the
 * transcript reads back exactly as it happened.
 */
export async function recordTurnFailure(args: {
  admin: SupabaseClient;
  conversationId: string | null;
  seq: number;
  content: string;
  errorCode: string;
}): Promise<void> {
  await recordMessage({
    admin: args.admin,
    conversationId: args.conversationId,
    seq: args.seq,
    role: "assistant",
    content: args.content,
    errorCode: args.errorCode,
  });
}

/**
 * Move a conversation to the top of the list, at turn START.
 *
 * `last_at` was previously written only by finishConversation, which the ask
 * route's outer catch never reaches — so a conversation that crashed kept an
 * ordering timestamp from whenever it last succeeded. Writing it up front
 * matches this module's own rule: the row is written before the thing it
 * describes happens.
 *
 * `error_code` is cleared because the conversation is live again; the failure
 * it referred to is preserved on the message row by recordTurnFailure.
 */
export async function touchConversation(
  admin: SupabaseClient,
  conversationId: string | null
): Promise<void> {
  if (!conversationId) return;
  const { error } = await admin
    .from("ai_conversations")
    .update({ last_at: new Date().toISOString(), status: "open", error_code: null })
    .eq("id", conversationId);
  if (error) console.error("[ai.audit] touch:", error.message);
}

export interface RecordToolCallArgs {
  admin: SupabaseClient;
  conversationId: string | null;
  messageSeq: number | null;
  toolName: string;
  /**
   * What the model asked for, verbatim, before any server rewrite.
   *
   * Stored alongside argsScoped on purpose: the delta between them is the
   * security signal. A model that tried to widen its own scope shows up as a
   * diff. Storing only what executed would hide precisely the attempt worth
   * knowing about.
   */
  argsRaw: unknown;
  argsScoped?: unknown;
  scopeApplied?: unknown;
  rowCount?: number | null;
  previewRowCount?: number | null;
  fieldKeys?: readonly string[];
  sensitiveIncluded?: boolean;
  durationMs?: number;
  errorCode?: string | null;
}

export async function recordToolCall(args: RecordToolCallArgs): Promise<void> {
  if (!args.conversationId) return;
  const { error } = await args.admin.from("ai_tool_calls").insert({
    conversation_id: args.conversationId,
    message_seq: args.messageSeq,
    tool_name: args.toolName,
    args_raw: args.argsRaw ?? null,
    args_scoped: args.argsScoped ?? null,
    scope_applied: args.scopeApplied ?? null,
    row_count: args.rowCount ?? null,
    preview_row_count: args.previewRowCount ?? null,
    field_keys: args.fieldKeys ?? [],
    sensitive_included: args.sensitiveIncluded ?? false,
    duration_ms: args.durationMs ?? null,
    error_code: args.errorCode ?? null,
  });
  if (error) console.error("[ai.audit] tool call:", error.message);
}

export async function finishConversation(
  admin: SupabaseClient,
  conversationId: string | null,
  status: "completed" | "error" | "aborted",
  errorCode?: string | null
): Promise<void> {
  if (!conversationId) return;
  const { error } = await admin
    .from("ai_conversations")
    .update({ status, error_code: errorCode ?? null, last_at: new Date().toISOString() })
    .eq("id", conversationId);
  if (error) console.error("[ai.audit] finish:", error.message);
}

export interface CreateQueryRunArgs {
  ctx: CallerContext;
  filters: unknown;
  fieldKeys: readonly string[];
  total: number;
  capped: boolean;
  academicYearId: string | null;
  /**
   * Which turn produced this run. Reopening a chat has no other way to put a
   * result chip under the answer it belongs to.
   */
  messageSeq?: number | null;
  /** The model's stated intent — the chip's label after a reload. */
  purpose?: string | null;
}

/**
 * Records a query run and returns its id — the handle the UI uses to fetch the
 * full table and the CSV.
 *
 * Stores the SCOPED filters, never rows. Re-running them is guaranteed to
 * reproduce what the caller was entitled to and nothing wider, and the stored
 * scope fingerprint lets the download path refuse if the caller's access
 * changed in between.
 */
export async function createQueryRun(
  args: CreateQueryRunArgs
): Promise<string | null> {
  const { data, error } = await args.ctx.admin
    .from("ai_query_runs")
    .insert({
      conversation_id: args.ctx.conversationId || null,
      filters: args.filters,
      field_keys: args.fieldKeys,
      total: args.total,
      capped: args.capped,
      scope_hash: scopeHash(args.ctx.scope),
      academic_year_id: args.academicYearId,
      message_seq: args.messageSeq ?? null,
      purpose: args.purpose ?? null,
    })
    .select("id")
    .single();

  if (error || !data) {
    console.error("[ai.audit] query run:", error?.message);
    return null;
  }
  return data.id as string;
}
