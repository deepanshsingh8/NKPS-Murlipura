import type { SupabaseClient } from "@supabase/supabase-js";
import type Anthropic from "@anthropic-ai/sdk";

/**
 * Reading chat history back.
 *
 * Deliberately separate from audit.ts, which is write-only by design and says
 * so. These are the only functions allowed to hand a conversation to a user,
 * and the ownership rule lives in exactly one of them.
 *
 * ── Why every read is a service-role query behind an API route ──────────────
 * All four ai_* tables have RLS enabled with zero policies, and migration 112
 * warns against adding one. That warning is not squeamishness: ai_conversations
 * is shared across features and channels, so the obvious policy — "rows where
 * actor_id = auth.uid()" — would also hand a teacher their remark-drafting runs
 * and a parent their WhatsApp session, in a UI built to show neither. Filtering
 * in TypeScript keeps "mine" and "this surface" as one decision.
 */

/** The Ask chat. Filtering on BOTH is load-bearing — see the header. */
export const ASK_SURFACE = { feature: "ask", channel: "erp_web" } as const;

export interface ConversationSummary {
  id: string;
  title: string | null;
  started_at: string;
  last_at: string;
  status: string;
}

export interface TranscriptRun {
  run_id: string;
  purpose: string | null;
  total: number;
  /** Its handle has lapsed; the row is a label now, not a result. */
  expired: boolean;
}

export interface TranscriptTurn {
  /** Stable across reloads, unlike a random client id. */
  id: string;
  seq: number;
  role: "user" | "assistant";
  content: string;
  /** The words were removed by a delete, not merely absent. */
  redacted: boolean;
  /** Why this turn produced no answer. */
  error_code: string | null;
  runs: TranscriptRun[];
}

interface ConversationRow {
  id: string;
  actor_id: string | null;
  title: string | null;
  title_source: string | null;
  started_at: string;
  last_at: string;
  status: string;
  scope_hash: string;
  academic_year_id: string | null;
}

const CONVERSATION_COLUMNS =
  "id, actor_id, title, title_source, started_at, last_at, status, scope_hash, academic_year_id";

/**
 * The single ownership gate.
 *
 * Returns null for "not yours" and "does not exist" alike, and callers must
 * turn that into a 404 rather than a 403. A 403 would confirm that some
 * other user's conversation exists at that id, which is the same enumeration
 * oracle the parent tools are careful to avoid.
 */
export async function loadOwnedConversation(
  admin: SupabaseClient,
  id: string,
  actorId: string
): Promise<ConversationRow | null> {
  const { data } = await admin
    .from("ai_conversations")
    .select(CONVERSATION_COLUMNS)
    .eq("id", id)
    .eq("actor_id", actorId)
    .eq("feature", ASK_SURFACE.feature)
    .eq("channel", ASK_SURFACE.channel)
    .is("deleted_at", null)
    .maybeSingle();

  return (data as unknown as ConversationRow) ?? null;
}

/**
 * One page of the caller's chats, newest activity first.
 *
 * Keyset pagination, not offset. This list reorders every time a reply lands,
 * so an offset would silently skip or repeat rows exactly when someone is
 * scrolling back through it.
 */
export async function listConversations(
  admin: SupabaseClient,
  actorId: string,
  opts: { limit: number; before?: string; q?: string }
): Promise<{ conversations: ConversationSummary[]; next_cursor: string | null }> {
  let query = admin
    .from("ai_conversations")
    .select("id, title, started_at, last_at, status")
    .eq("actor_id", actorId)
    .eq("feature", ASK_SURFACE.feature)
    .eq("channel", ASK_SURFACE.channel)
    .is("deleted_at", null)
    .order("last_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(opts.limit + 1);

  if (opts.before) query = query.lt("last_at", opts.before);

  // Titles only. Searching message bodies would mean building an index over
  // the student facts migration 114 went out of its way to contain.
  if (opts.q?.trim()) query = query.ilike("title", `%${opts.q.trim()}%`);

  const { data, error } = await query;
  if (error) {
    console.error("[ai.conversations] list:", error.message);
    return { conversations: [], next_cursor: null };
  }

  const rows = (data ?? []) as unknown as ConversationSummary[];
  const hasMore = rows.length > opts.limit;
  const page = hasMore ? rows.slice(0, opts.limit) : rows;

  return {
    conversations: page,
    next_cursor: hasMore ? page[page.length - 1].last_at : null,
  };
}

interface MessageRow {
  seq: number;
  role: "user" | "assistant";
  content: string | null;
  stop_reason: string | null;
  error_code: string | null;
  redacted_at: string | null;
}

interface RunRow {
  id: string;
  purpose: string | null;
  total: number;
  message_seq: number | null;
  expires_at: string;
  created_at: string;
}

/**
 * Rebuild a conversation as the user should see it.
 *
 * Two things make this less mechanical than it looks.
 *
 * **Intermediate rounds are dropped.** An assistant row whose stop_reason is
 * 'tool_use' is the model announcing it is about to look something up. Those
 * are stored (they carry the token counts) but never rendered, or reopening a
 * chat would replay "Let me check the class list." as if it were an answer.
 *
 * **Runs attach by turn, not by seq equality.** ai_query_runs.message_seq is
 * the seq of the round that ISSUED the tool call — one of the rounds we just
 * dropped. So a turn owns every run whose seq falls between its user message
 * and the next one, and they land on that turn's visible answer.
 */
export async function loadTranscript(
  admin: SupabaseClient,
  conversationId: string
): Promise<TranscriptTurn[]> {
  const [messages, runs] = await Promise.all([
    admin
      .from("ai_messages")
      .select("seq, role, content, stop_reason, error_code, redacted_at")
      .eq("conversation_id", conversationId)
      .order("seq", { ascending: true }),
    admin
      .from("ai_query_runs")
      .select("id, purpose, total, message_seq, expires_at, created_at")
      .eq("conversation_id", conversationId)
      .order("created_at", { ascending: true }),
  ]);

  const messageRows = (messages.data ?? []) as unknown as MessageRow[];
  const runRows = ((runs.data ?? []) as unknown as RunRow[]).filter(
    // Pre-114 runs carry no attribution and cannot be placed. Showing them
    // under an arbitrary answer would be worse than not showing them.
    (r) => r.message_seq != null
  );

  const visible = messageRows.filter(
    (m) => !(m.role === "assistant" && m.stop_reason === "tool_use")
  );

  // Turn boundaries, from the FULL message list — the dropped rounds are
  // exactly the ones runs are attributed to, so they must still count here.
  const userSeqs = messageRows.filter((m) => m.role === "user").map((m) => m.seq);
  const now = Date.now();

  const turns: TranscriptTurn[] = visible.map((m) => ({
    id: `${conversationId}:${m.seq}`,
    seq: m.seq,
    role: m.role,
    content: m.content ?? "",
    redacted: m.redacted_at != null,
    error_code: m.error_code ?? null,
    runs: [],
  }));

  for (const run of runRows) {
    const seq = run.message_seq as number;

    // Which turn does this belong to: the last user message at or before it.
    const turnStart = userSeqs.filter((s) => s <= seq).pop();
    if (turnStart == null) continue;
    const turnEnd = userSeqs.find((s) => s > turnStart) ?? Infinity;

    // Its visible answer: the first rendered assistant message in that range.
    const target = turns.find(
      (t) => t.role === "assistant" && t.seq > turnStart && t.seq < turnEnd
    );
    if (!target) continue;

    target.runs.push({
      run_id: run.id,
      purpose: run.purpose,
      total: run.total,
      expired: new Date(run.expires_at).getTime() < now,
    });
  }

  return turns;
}

/**
 * The model's view of the conversation so far, rebuilt from the database.
 *
 * The point is not convenience — it is that the browser stops being the source
 * of truth for what was said. Client-supplied history could always assert a
 * prior turn that never happened; once a conversation has an id, this replaces
 * it and that whole class of manipulation is gone.
 *
 * Callers still pass the result through normaliseHistory, which enforces
 * alternation and the length cap. Those rules apply to database rows too: a
 * turn whose answer failed leaves a question with no reply.
 */
export async function historyFromDb(
  admin: SupabaseClient,
  conversationId: string,
  maxMessages: number
): Promise<{ role: "user" | "assistant"; content: string }[]> {
  const { data } = await admin
    .from("ai_messages")
    .select("seq, role, content, stop_reason")
    .eq("conversation_id", conversationId)
    .order("seq", { ascending: true });

  const rows = ((data ?? []) as unknown as MessageRow[])
    .filter((m) => !(m.role === "assistant" && m.stop_reason === "tool_use"))
    .filter((m) => (m.content ?? "").trim().length > 0);

  return rows.slice(-maxMessages).map((m) => ({
    role: m.role,
    content: m.content as string,
  }));
}

/** Narrow the shared history shape to what the SDK wants. */
export function toMessageParams(
  history: { role: "user" | "assistant"; content: string }[]
): Anthropic.MessageParam[] {
  return history.map((h) => ({ role: h.role, content: h.content }));
}
