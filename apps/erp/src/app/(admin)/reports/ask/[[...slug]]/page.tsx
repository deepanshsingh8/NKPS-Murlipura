"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft,
  Check,
  Copy,
  CornerDownLeft,
  Loader2,
  PanelLeft,
  Pencil,
  RefreshCw,
  ShieldAlert,
  Square,
} from "lucide-react";
import { adminFetch } from "@nkps/shared/lib/admin-api";
import { ChatMarkdown } from "@/components/ChatMarkdown";
import { ConversationList } from "@/components/ask/ConversationList";
import { AnswerTable } from "@/components/ask/AnswerTable";
import type {
  AskRun,
  ConversationSummary,
  TableState,
  Turn,
} from "@/components/ask/types";
import { AgentMark } from "@nkps/shared/components/icons/AgentMark";

/**
 * Ask-your-school.
 *
 * A natural-language front door onto the report builder — same data, same
 * `reports` permission, same export audit trail. The assistant never sees the
 * full result set: it works from counts and a short preview, and each table is
 * fetched separately under a fresh authorization check.
 *
 * ── The URL owns which conversation is open ──────────────────────────────────
 * /reports/ask is a new chat and creates no row until the first message is
 * sent, so the list never fills with empty chats. /reports/ask/<id> is that
 * conversation. Everything else follows from that: refreshing keeps your place,
 * the back button works, and a chat can be linked to.
 */

const EXAMPLES = [
  "Class IX students with fees pending who don't take the bus",
  "How many students per class are below 75% attendance?",
  "New admissions this session, with father's name and phone",
  "Students in Class XI Science sorted by admission number",
];

const newId = () =>
  typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random()}`;

export default function AskPage() {
  const router = useRouter();
  const params = useParams<{ slug?: string[] }>();
  const slugId = params?.slug?.[0] ?? null;

  const [turns, setTurns] = useState<Turn[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [listLoading, setListLoading] = useState(true);
  const [transcriptLoading, setTranscriptLoading] = useState(false);

  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [allowSensitive, setAllowSensitive] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState("");
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [listOpen, setListOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const endRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [turns]);

  useEffect(
    () => () => {
      abortRef.current?.abort();
      if (copyTimer.current) clearTimeout(copyTimer.current);
    },
    []
  );

  const patchTurn = useCallback((id: string, patch: Partial<Turn>) => {
    setTurns((prev) => prev.map((t) => (t.id === id ? { ...t, ...patch } : t)));
  }, []);

  // ── The chat list ─────────────────────────────────────────────────────────
  const refreshList = useCallback(async (q?: string) => {
    setListLoading(true);
    try {
      const url = q?.trim()
        ? `/api/ai/conversations?q=${encodeURIComponent(q.trim())}`
        : "/api/ai/conversations";
      const res = await adminFetch(url);
      if (!res.ok) return;
      const data = await res.json();
      setConversations(data.conversations ?? []);
    } catch {
      // A chat list that won't load must not stop you asking a question.
    } finally {
      setListLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshList();
  }, [refreshList]);

  // ── Loading a saved conversation ──────────────────────────────────────────
  const loadTable = useCallback(
    async (turnId: string, runId: string) => {
      patchTurn(turnId, { tableBusy: true, activeRunId: runId });
      try {
        const res = await adminFetch(`/api/ai/ask/${runId}/table?page_size=50`);
        const data = await res.json();
        if (!res.ok) {
          patchTurn(turnId, { tableBusy: false, table: null });
          return;
        }
        patchTurn(turnId, {
          tableBusy: false,
          table: {
            runId,
            headers: data.headers,
            rows: data.rows,
            total: data.total,
          } as TableState,
        });
      } catch {
        patchTurn(turnId, { tableBusy: false, table: null });
      }
    },
    [patchTurn]
  );

  const openTranscript = useCallback(
    async (id: string) => {
      setTranscriptLoading(true);
      setError(null);
      try {
        const res = await adminFetch(`/api/ai/conversations/${id}`);
        if (!res.ok) {
          setError("That chat is no longer available.");
          setTurns([]);
          router.replace("/reports/ask");
          return;
        }
        const data = await res.json();

        const loaded: Turn[] = (data.turns ?? []).map(
          (t: {
            id: string;
            role: "user" | "assistant";
            content: string;
            redacted: boolean;
            error_code: string | null;
            runs: { run_id: string; purpose: string | null; total: number; expired: boolean }[];
          }) => ({
            id: t.id,
            role: t.role,
            content: t.content,
            redacted: t.redacted,
            error: null,
            runs: t.runs.map((r) => ({
              runId: r.run_id,
              purpose: r.purpose ?? "Report",
              total: r.total,
              expired: r.expired,
            })),
            activeRunId: t.runs.length ? t.runs[t.runs.length - 1].run_id : null,
          })
        );

        setTurns(loaded);
        setConversationId(id);

        // Only the LAST answer's table loads by itself. Applying the live
        // behaviour to a whole transcript would fire one report per turn on
        // page open — a dozen parallel re-executions, each capped at 19,999
        // rows, for tables nobody has looked at yet.
        const last = [...loaded].reverse().find((t) => (t.runs?.length ?? 0) > 0);
        const run = last?.runs?.[last.runs.length - 1];
        if (last && run && !run.expired) void loadTable(last.id, run.runId);
      } catch {
        setError("Couldn't open that chat.");
      } finally {
        setTranscriptLoading(false);
      }
    },
    [loadTable, router]
  );

  useEffect(() => {
    if (!slugId) {
      if (conversationId !== null) {
        setTurns([]);
        setConversationId(null);
      }
      return;
    }
    // Equal means we navigated here ourselves after the first reply — the live
    // transcript is already on screen and re-fetching would blank it.
    if (slugId === conversationId) return;
    void openTranscript(slugId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slugId]);

  // ── Asking ────────────────────────────────────────────────────────────────
  /**
   * Send one turn.
   *
   * `resumeId` null means start a new conversation, which is what regenerate
   * and edit do: they rewind the transcript, and rather than teaching the
   * server about branches they simply begin a fresh chat from the truncated
   * history. Two affordances, no message tree, and the new chat gets its own
   * title.
   */
  const send = useCallback(
    async (
      question: string,
      opts: { prefix: Turn[]; resumeId: string | null }
    ) => {
      const trimmed = question.trim();
      if (!trimmed) return;

      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      const assistantId = newId();
      setTurns([
        ...opts.prefix,
        { id: newId(), role: "user", content: trimmed },
        { id: assistantId, role: "assistant", content: "", streaming: true, steps: [] },
      ]);
      setBusy(true);
      setError(null);

      let answer = "";
      let landedId: string | null = opts.resumeId;

      try {
        const res = await adminFetch("/api/ai/ask", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: controller.signal,
          body: JSON.stringify({
            message: trimmed,
            conversation_id: opts.resumeId,
            // Only sent when starting fresh. Once a conversation has an id the
            // server rebuilds history from the database and ignores this.
            history: opts.resumeId
              ? undefined
              : opts.prefix.map((t) => ({ role: t.role, content: t.content })),
            allow_sensitive: allowSensitive,
          }),
        });

        if (!res.ok || !res.body) {
          const data = await res.json().catch(() => ({}));
          patchTurn(assistantId, {
            streaming: false,
            error: data.error ?? "That didn't work.",
          });
          // A chat that outlived its academic session, or an account whose
          // access narrowed. Both mean "start a new one", and saying so beats
          // a dead chat that silently refuses every message.
          if (data.code === "SESSION_CHANGED" || data.code === "SCOPE_CHANGED") {
            setConversationId(null);
          }
          return;
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          // SSE frames are separated by a blank line; the tail may be partial.
          const frames = buffer.split("\n\n");
          buffer = frames.pop() ?? "";

          for (const frame of frames) {
            const line = frame.split("\n").find((l) => l.startsWith("data: "));
            if (!line) continue;

            let ev: Record<string, unknown>;
            try {
              ev = JSON.parse(line.slice(6));
            } catch {
              continue;
            }

            if (ev.type === "start") {
              landedId = (ev.conversation_id as string | null) ?? null;
              if (landedId) {
                setConversationId(landedId);
                router.replace(`/reports/ask/${landedId}`, { scroll: false });
              }
            } else if (ev.type === "delta") {
              answer += ev.text as string;
              patchTurn(assistantId, { content: answer, activeTool: null });
            } else if (ev.type === "round_end") {
              // The text just streamed was a preamble, not the answer. Move it
              // to the progress list and start over, so the live view matches
              // what a reload will show.
              if (ev.hadTools) {
                const preamble = answer.trim();
                answer = "";
                setTurns((prev) =>
                  prev.map((t) =>
                    t.id === assistantId
                      ? {
                          ...t,
                          content: "",
                          steps: preamble ? [...(t.steps ?? []), preamble] : t.steps,
                        }
                      : t
                  )
                );
              }
            } else if (ev.type === "tool_start") {
              patchTurn(assistantId, {
                activeTool: (ev.label as string | null) ?? (ev.name as string),
              });
            } else if (ev.type === "tool_done") {
              patchTurn(assistantId, { activeTool: null });
            } else if (ev.type === "done") {
              const runs: AskRun[] = ((ev.runs as unknown[]) ?? []).map((r) => {
                const run = r as { run_id: string; purpose: string; total: number };
                return { runId: run.run_id, purpose: run.purpose, total: run.total };
              });
              const shown = runs[runs.length - 1];
              patchTurn(assistantId, {
                // The server's text is authoritative: deltas from earlier
                // rounds were deliberately discarded above.
                content: (ev.text as string) || answer,
                streaming: false,
                activeTool: null,
                runs,
                activeRunId: shown?.runId ?? null,
                tableBusy: Boolean(shown),
              });
              if (shown) void loadTable(assistantId, shown.runId);
              void refreshList();
            }
          }
        }

        // The stream ended without a `done`. Only an abort does that.
        patchTurn(assistantId, { streaming: false });
      } catch {
        if (controller.signal.aborted) {
          patchTurn(assistantId, { streaming: false, stopped: true, activeTool: null });
          void refreshList();
        } else {
          patchTurn(assistantId, {
            streaming: false,
            error: "Couldn't reach the assistant. The report builder still works.",
          });
        }
      } finally {
        if (abortRef.current === controller) {
          abortRef.current = null;
          setBusy(false);
        }
      }
    },
    [allowSensitive, patchTurn, loadTable, refreshList, router]
  );

  function submit(question: string) {
    setInput("");
    void send(question, { prefix: turns, resumeId: conversationId });
  }

  function regenerate(assistantIndex: number) {
    const question = turns[assistantIndex - 1];
    if (!question || question.role !== "user") return;
    void send(question.content, {
      prefix: turns.slice(0, assistantIndex - 1),
      resumeId: null,
    });
  }

  function saveEdit(userIndex: number) {
    const next = editDraft.trim();
    setEditingId(null);
    if (!next) return;
    void send(next, { prefix: turns.slice(0, userIndex), resumeId: null });
  }

  async function rerun(turnId: string, runId: string) {
    patchTurn(turnId, { rerunning: true });
    try {
      const res = await adminFetch(`/api/ai/ask/${runId}/rerun`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        patchTurn(turnId, { rerunning: false });
        setError(data.error ?? "Couldn't re-run that result.");
        return;
      }
      setTurns((prev) =>
        prev.map((t) =>
          t.id === turnId
            ? {
                ...t,
                rerunning: false,
                activeRunId: data.run_id,
                runs: (t.runs ?? []).map((r) =>
                  r.runId === runId
                    ? { ...r, runId: data.run_id, total: data.total, expired: false }
                    : r
                ),
              }
            : t
        )
      );
      void loadTable(turnId, data.run_id);
    } catch {
      patchTurn(turnId, { rerunning: false });
    }
  }

  async function rename(id: string, title: string) {
    const clean = title.trim();
    if (!clean) return;
    setConversations((prev) =>
      prev.map((c) => (c.id === id ? { ...c, title: clean } : c))
    );
    await adminFetch(`/api/ai/conversations/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: clean }),
    });
  }

  async function remove(id: string) {
    setConversations((prev) => prev.filter((c) => c.id !== id));
    await adminFetch(`/api/ai/conversations/${id}`, { method: "DELETE" });
    if (id === conversationId) router.push("/reports/ask");
  }

  async function copy(turn: Turn) {
    try {
      await navigator.clipboard.writeText(turn.content);
      setCopiedId(turn.id);
      if (copyTimer.current) clearTimeout(copyTimer.current);
      copyTimer.current = setTimeout(() => setCopiedId(null), 1600);
    } catch {
      // Clipboard access can be refused; a failed copy needs no ceremony.
    }
  }

  const activeTitle =
    conversations.find((c) => c.id === conversationId)?.title ?? null;

  return (
    <div className="flex h-full min-h-0">
      {/* ── Past chats ────────────────────────────────────────────────────── */}
      <aside className="hidden w-72 shrink-0 border-r bg-cream-50 dark:bg-card md:block">
        <ConversationList
          conversations={conversations}
          activeId={conversationId}
          loading={listLoading}
          onNew={() => router.push("/reports/ask")}
          onOpen={(id) => router.push(`/reports/ask/${id}`)}
          onRename={rename}
          onDelete={remove}
          onSearch={(q) => void refreshList(q)}
        />
      </aside>

      {listOpen && (
        <>
          <div
            onClick={() => setListOpen(false)}
            aria-hidden
            className="fixed inset-0 z-20 bg-black/40 md:hidden"
          />
          <aside className="fixed inset-y-0 left-0 z-30 w-72 border-r bg-cream-50 dark:bg-card md:hidden">
            <ConversationList
              conversations={conversations}
              activeId={conversationId}
              loading={listLoading}
              onNew={() => {
                setListOpen(false);
                router.push("/reports/ask");
              }}
              onOpen={(id) => {
                setListOpen(false);
                router.push(`/reports/ask/${id}`);
              }}
              onRename={rename}
              onDelete={remove}
              onSearch={(q) => void refreshList(q)}
            />
          </aside>
        </>
      )}

      {/* ── The conversation ──────────────────────────────────────────────── */}
      <section className="flex min-w-0 flex-1 flex-col">
        <header className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b bg-white dark:bg-card px-4 py-2.5 sm:px-6">
          <div className="flex min-w-0 items-center gap-2.5">
            <button
              type="button"
              onClick={() => setListOpen(true)}
              className="rounded-md p-1.5 text-muted-foreground hover:text-navy-900 dark:hover:text-white md:hidden"
              title="Past chats"
            >
              <PanelLeft className="h-4 w-4" />
            </button>
            <div className="min-w-0">
              <Link
                href="/reports"
                className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-blue-700"
              >
                <ArrowLeft className="h-3 w-3" />
                Reports
              </Link>
              <h1 className="truncate font-heading text-base font-semibold text-navy-900 dark:text-white">
                {activeTitle ?? "Ask your school"}
              </h1>
            </div>
          </div>

          <label className="flex items-center gap-2 rounded-lg border bg-white dark:bg-card px-2.5 py-1.5 text-xs">
            <input
              type="checkbox"
              checked={allowSensitive}
              onChange={(e) => setAllowSensitive(e.target.checked)}
              className="h-3.5 w-3.5"
            />
            <span className="font-medium text-navy-900 dark:text-white">Include PII</span>
            <span className="hidden text-muted-foreground lg:inline">
              Aadhaar, income, addresses, contact numbers
            </span>
          </label>
        </header>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-5 sm:px-6">
          {transcriptLoading && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Opening…
            </div>
          )}

          {!transcriptLoading && turns.length === 0 && (
            <div className="mx-auto max-w-2xl rounded-lg border bg-white dark:bg-card p-5">
              <div className="mb-3 flex items-center gap-2 text-sm font-medium text-navy-900 dark:text-white">
                <AgentMark className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                Ask for a list in plain language
              </div>
              <p className="mb-4 text-sm text-muted-foreground">
                Same records, same permissions and same export log as the report
                builder.
              </p>
              <div className="grid gap-2 sm:grid-cols-2">
                {EXAMPLES.map((example) => (
                  <button
                    key={example}
                    type="button"
                    onClick={() => submit(example)}
                    className="rounded-md border px-3 py-2 text-left text-sm text-muted-foreground transition hover:border-blue-400 hover:text-navy-900 dark:hover:text-white"
                  >
                    {example}
                  </button>
                ))}
              </div>
            </div>
          )}

          {error && (
            <div className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 dark:bg-amber-950/30 px-4 py-3 text-sm text-amber-900 dark:text-amber-300">
              <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {turns.map((turn, i) =>
            turn.role === "user" ? (
              <div key={turn.id} className="group flex justify-end gap-2">
                {editingId === turn.id ? (
                  <div className="w-full max-w-[75%] rounded-lg border bg-white dark:bg-card p-2">
                    <textarea
                      value={editDraft}
                      autoFocus
                      onChange={(e) => setEditDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && !e.shiftKey) {
                          e.preventDefault();
                          saveEdit(i);
                        }
                        if (e.key === "Escape") setEditingId(null);
                      }}
                      rows={2}
                      className="w-full resize-none bg-transparent px-1 py-0.5 text-sm text-navy-900 dark:text-white outline-none"
                    />
                    <div className="flex justify-end gap-1.5 pt-1">
                      <button
                        type="button"
                        onClick={() => setEditingId(null)}
                        className="rounded-md px-2.5 py-1 text-xs text-muted-foreground hover:text-navy-900 dark:hover:text-white"
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        onClick={() => saveEdit(i)}
                        className="rounded-md bg-blue-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-blue-700"
                      >
                        Ask in a new chat
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    {/* Editing rewinds and starts a fresh chat, so the saved
                        one is never rewritten under you. */}
                    <button
                      type="button"
                      title="Edit and ask again"
                      onClick={() => {
                        setEditDraft(turn.content);
                        setEditingId(turn.id);
                      }}
                      className="mt-1 self-start rounded-md p-1.5 text-muted-foreground opacity-0 transition group-hover:opacity-100 hover:text-navy-900 dark:hover:text-white"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                    <div className="max-w-[75%] whitespace-pre-wrap rounded-lg bg-navy-900 px-4 py-2.5 text-sm text-white">
                      {turn.content}
                    </div>
                  </>
                )}
              </div>
            ) : (
              <div key={turn.id} className="max-w-[85%] space-y-2">
                {(turn.steps ?? []).map((step, si) => (
                  <p key={si} className="text-sm italic text-muted-foreground">
                    {step}
                  </p>
                ))}

                {turn.activeTool && (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    {turn.activeTool}
                  </div>
                )}

                {turn.content && (
                  <div className="rounded-lg border bg-white dark:bg-card px-4 py-3 text-sm text-navy-900 dark:text-white">
                    {/* Plain text while streaming. Re-parsing markdown on every
                        delta makes half-built tables flicker into and out of
                        existence; it becomes markdown the moment it settles. */}
                    {turn.streaming ? (
                      <p className="whitespace-pre-wrap">{turn.content}</p>
                    ) : (
                      <ChatMarkdown>{turn.content}</ChatMarkdown>
                    )}
                  </div>
                )}

                {turn.redacted && !turn.content && (
                  <p className="text-sm italic text-muted-foreground">
                    This answer was removed when the chat was deleted.
                  </p>
                )}

                {turn.streaming && !turn.content && !turn.activeTool && (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Working through the records…
                  </div>
                )}

                {turn.stopped && !turn.content && (
                  <div className="text-sm text-muted-foreground">
                    Stopped.{" "}
                    <button
                      type="button"
                      onClick={() => regenerate(i)}
                      className="underline underline-offset-2 hover:text-navy-900 dark:hover:text-white"
                    >
                      Ask it again
                    </button>
                  </div>
                )}

                {turn.error && (
                  <div className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 dark:bg-amber-950/30 px-4 py-3 text-sm text-amber-900 dark:text-amber-300">
                    <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
                    <span>{turn.error}</span>
                  </div>
                )}

                <AnswerTable
                  turn={turn}
                  onSelectRun={(runId) => void loadTable(turn.id, runId)}
                  onRerun={(runId) => void rerun(turn.id, runId)}
                />

                {!turn.streaming && (turn.content || turn.error) && (
                  <div className="flex items-center gap-1">
                    {turn.content && (
                      <button
                        type="button"
                        onClick={() => void copy(turn)}
                        className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-muted-foreground transition hover:text-navy-900 dark:hover:text-white"
                      >
                        {copiedId === turn.id ? (
                          <>
                            <Check className="h-3.5 w-3.5" />
                            Copied
                          </>
                        ) : (
                          <>
                            <Copy className="h-3.5 w-3.5" />
                            Copy
                          </>
                        )}
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => regenerate(i)}
                      className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-muted-foreground transition hover:text-navy-900 dark:hover:text-white"
                    >
                      <RefreshCw className="h-3.5 w-3.5" />
                      Regenerate
                    </button>
                  </div>
                )}
              </div>
            )
          )}

          <div ref={endRef} />
        </div>

        <div className="shrink-0 border-t bg-white dark:bg-card px-4 py-3 sm:px-6">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              submit(input);
            }}
            className="flex items-end gap-2 rounded-lg border p-2"
          >
            {/* Never disabled while busy: interrupting with a new question is
                the point, and Stop is right there for abandoning one. */}
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  submit(input);
                }
              }}
              rows={1}
              placeholder="e.g. Class VIII students who haven't paid Term 2"
              className="max-h-32 flex-1 resize-none bg-transparent px-2 py-1.5 text-sm outline-none placeholder:text-muted-foreground"
            />
            {busy ? (
              <button
                type="button"
                onClick={() => abortRef.current?.abort()}
                className="inline-flex shrink-0 items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm font-medium text-navy-900 dark:text-white transition hover:border-red-400 hover:text-red-700"
              >
                <Square className="h-3 w-3 fill-current" />
                Stop
              </button>
            ) : (
              <button
                type="submit"
                disabled={!input.trim()}
                className="inline-flex shrink-0 items-center gap-1.5 rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-blue-700 disabled:opacity-40"
              >
                Ask
                <CornerDownLeft className="h-3.5 w-3.5" />
              </button>
            )}
          </form>
          <p className="pt-2 text-xs text-muted-foreground">
            The assistant only ever sees a short preview of the rows — each table
            is fetched separately and re-checks your access. Every download is
            logged like any other export.
          </p>
        </div>
      </section>
    </div>
  );
}
