"use client";

import { useState, useRef, useEffect } from "react";
import { createClient } from "@nkps/shared/lib/supabase/client";
import { Loader2, Send } from "lucide-react";
import { ChatMarkdown } from "@/components/ChatMarkdown";

/**
 * The parent assistant, in the portal.
 *
 * Deliberately plain: a parent opens this on a phone, usually with one
 * question. No filters, no columns, no settings — a text box and an answer.
 * The same assistant will answer over WhatsApp; this is the authenticated
 * channel, built first so the tools and scoping are exercised against a proven
 * identity before any of it is exposed to a phone number.
 */

interface Turn {
  role: "user" | "assistant";
  content: string;
}

const SUGGESTIONS = [
  "How many days has my child missed?",
  "Is there any fee pending?",
  "When is the next PTM?",
  "What is tomorrow's timetable?",
];

export default function ParentAskPage() {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [turns, busy]);

  async function ask(question: string) {
    const trimmed = question.trim();
    if (!trimmed || busy) return;

    setInput("");
    const history = turns.map((t) => ({ role: t.role, content: t.content }));
    setTurns((prev) => [...prev, { role: "user", content: trimmed }]);
    setBusy(true);

    try {
      const supabase = createClient();
      const {
        data: { session },
      } = await supabase.auth.getSession();

      const res = await fetch("/api/ai/parent", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(session?.access_token
            ? { Authorization: `Bearer ${session.access_token}` }
            : {}),
        },
        body: JSON.stringify({ message: trimmed, history }),
      });
      const data = await res.json();

      setTurns((prev) => [
        ...prev,
        {
          role: "assistant",
          content:
            data.reply ??
            data.error ??
            "Sorry, I couldn't answer that. Please contact the school office.",
        },
      ]);
    } catch {
      setTurns((prev) => [
        ...prev,
        {
          role: "assistant",
          content:
            "I couldn't connect just now. Please try again, or contact the school office.",
        },
      ]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto flex h-full max-w-2xl flex-col gap-4 p-4 sm:p-6">
      <div>
        <h1 className="font-heading text-xl font-semibold text-navy-900 dark:text-white">
          Ask the school
        </h1>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          Attendance, fees, results, timetable and PTM dates for your own
          children.
        </p>
      </div>

      {turns.length === 0 && (
        <div className="grid gap-2 sm:grid-cols-2">
          {SUGGESTIONS.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => void ask(s)}
              className="rounded-lg border border-gray-200 bg-white px-3 py-2.5 text-left text-sm text-gray-600 transition hover:border-blue-400 hover:text-navy-900 dark:border-border dark:bg-muted dark:text-gray-300"
            >
              {s}
            </button>
          ))}
        </div>
      )}

      <div className="flex-1 space-y-3 overflow-y-auto">
        {turns.map((turn, i) =>
          turn.role === "user" ? (
            <div
              key={i}
              className="ml-auto max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-sm bg-navy-900 px-3.5 py-2 text-sm text-white"
            >
              {turn.content}
            </div>
          ) : (
            <div
              key={i}
              className="max-w-[90%] rounded-2xl rounded-bl-sm border border-gray-200 bg-white px-3.5 py-2.5 text-sm text-navy-900 dark:border-border dark:bg-muted dark:text-gray-100"
            >
              <ChatMarkdown>{turn.content}</ChatMarkdown>
            </div>
          )
        )}
        {busy && (
          <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400">
            <Loader2 className="h-4 w-4 animate-spin" />
            Checking…
          </div>
        )}
        <div ref={endRef} />
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          void ask(input);
        }}
        className="flex items-center gap-2 rounded-full border border-gray-200 bg-white p-1.5 pl-4 dark:border-border dark:bg-muted"
      >
        <input /* mobile-layout-ok: custom chrome, sized for touch and 16px below */
          value={input}
          onChange={(e) => setInput(e.target.value)}
          disabled={busy}
          placeholder="Ask about your child…"
          className="flex-1 bg-transparent text-base sm:text-sm outline-none placeholder:text-gray-400"
        />
        <button
          type="submit"
          disabled={busy || !input.trim()}
          aria-label="Send"
          className="flex h-8 w-8 items-center justify-center rounded-full bg-blue-600 text-white transition hover:bg-blue-700 disabled:opacity-40"
        >
          <Send className="h-4 w-4" />
        </button>
      </form>

      <p className="text-center text-xs text-gray-400">
        Answers come from the school&rsquo;s own records. For anything that needs
        a decision, please contact the office.
      </p>
    </div>
  );
}
