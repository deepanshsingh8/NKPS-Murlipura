"use client";

import { useState } from "react";
import { Check, MessageSquarePlus, Pencil, Search, Trash2, X } from "lucide-react";
import type { ConversationSummary } from "./types";

/**
 * Past chats.
 *
 * Ordered by last activity, not by when they were started — a chat you replied
 * to this morning belongs above one you opened last week and abandoned.
 *
 * Search is over titles only. Searching message bodies would mean indexing the
 * student facts migration 114 went out of its way to contain.
 */
export function ConversationList({
  conversations,
  activeId,
  loading,
  onNew,
  onOpen,
  onRename,
  onDelete,
  onSearch,
}: {
  conversations: ConversationSummary[];
  activeId: string | null;
  loading: boolean;
  onNew: () => void;
  onOpen: (id: string) => void;
  onRename: (id: string, title: string) => void;
  onDelete: (id: string) => void;
  onSearch: (q: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [confirmId, setConfirmId] = useState<string | null>(null);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0 space-y-2 p-3">
        <button
          type="button"
          onClick={onNew}
          className="flex w-full items-center gap-2 rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white transition hover:bg-blue-700"
        >
          <MessageSquarePlus className="h-4 w-4" />
          New chat
        </button>

        <div className="flex items-center gap-2 rounded-md border bg-white dark:bg-card px-2.5 py-1.5">
          <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <input /* mobile-layout-ok: borderless inside its own styled container; sized above */
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              onSearch(e.target.value);
            }}
            placeholder="Search chats"
            className="w-full bg-transparent text-base sm:text-xs outline-none placeholder:text-muted-foreground"
          />
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
        {loading && conversations.length === 0 && (
          <p className="px-2 py-3 text-xs text-muted-foreground">Loading…</p>
        )}

        {!loading && conversations.length === 0 && (
          <p className="px-2 py-3 text-xs text-muted-foreground">
            {query
              ? "No chat by that name."
              : "Your questions will be saved here so you can come back to them."}
          </p>
        )}

        <ul className="space-y-0.5">
          {conversations.map((c) => {
            const active = c.id === activeId;

            if (editingId === c.id) {
              return (
                <li key={c.id} className="rounded-md border bg-white dark:bg-card p-1.5">
                  <input /* mobile-layout-ok: borderless inside its own styled container; sized above */
                    value={draft}
                    autoFocus
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        onRename(c.id, draft);
                        setEditingId(null);
                      }
                      if (e.key === "Escape") setEditingId(null);
                    }}
                    className="w-full bg-transparent px-1 text-base sm:text-sm outline-none"
                  />
                  <div className="flex justify-end gap-1 pt-1">
                    <button
                      type="button"
                      onClick={() => setEditingId(null)}
                      className="rounded p-1 text-muted-foreground hover:text-navy-900"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        onRename(c.id, draft);
                        setEditingId(null);
                      }}
                      className="rounded p-1 text-blue-600 dark:text-blue-400 hover:text-blue-700"
                    >
                      <Check className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </li>
              );
            }

            return (
              <li key={c.id} className="group relative">
                <button
                  type="button"
                  onClick={() => onOpen(c.id)}
                  className={
                    active
                      ? "block w-full truncate rounded-md bg-blue-50 dark:bg-blue-950/30 px-2.5 py-2 pr-14 text-left text-sm font-medium text-navy-900 dark:text-white"
                      : "block w-full truncate rounded-md px-2.5 py-2 pr-14 text-left text-sm text-muted-foreground transition hover:bg-white hover:text-navy-900"
                  }
                  title={c.title ?? "Untitled chat"}
                >
                  {c.title ?? "Untitled chat"}
                </button>

                <div className="absolute right-1 top-1.5 flex items-center gap-0.5 opacity-0 transition group-hover:opacity-100 focus-within:opacity-100">
                  <button
                    type="button"
                    title="Rename"
                    onClick={() => {
                      setDraft(c.title ?? "");
                      setEditingId(c.id);
                    }}
                    className="rounded p-1 text-muted-foreground hover:text-navy-900"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    title={confirmId === c.id ? "Click again to delete" : "Delete"}
                    onClick={() => {
                      // Two clicks, no dialog. Deleting also blanks the
                      // answers, so it should not be a single stray click —
                      // but a modal for a chat is heavier than the act.
                      if (confirmId === c.id) {
                        onDelete(c.id);
                        setConfirmId(null);
                      } else {
                        setConfirmId(c.id);
                        setTimeout(() => setConfirmId((v) => (v === c.id ? null : v)), 3000);
                      }
                    }}
                    className={
                      confirmId === c.id
                        ? "rounded bg-red-600 p-1 text-white"
                        : "rounded p-1 text-muted-foreground hover:text-red-700"
                    }
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
