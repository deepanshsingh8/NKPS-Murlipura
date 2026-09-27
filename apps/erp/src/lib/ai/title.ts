import type { SupabaseClient } from "@supabase/supabase-js";
import { getAiClient, isAiConfigured, AI_MODELS } from "./client";

/**
 * Naming a chat.
 *
 * Two mechanisms, and the order matters. The deterministic one runs
 * synchronously at conversation creation so the list can never show an
 * untitled row; the model one upgrades it afterwards. Doing only the second
 * would mean a slow or failed Haiku call leaves a chat permanently nameless,
 * and the failure would be invisible because nothing is waiting on it.
 */

const MAX_TITLE = 80;

/**
 * A title from the question itself. Never throws, never returns blank.
 *
 * Cuts on a word boundary where it can, because "Class IX students with fees…"
 * reads as a name and "Class IX students with fe…" reads as a bug.
 */
export function fallbackTitle(question: string): string {
  const clean = question.replace(/\s+/g, " ").trim();
  if (!clean) return "New chat";
  if (clean.length <= 60) return clean;

  const cut = clean.slice(0, 60);
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > 30 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}

/**
 * Replace the deterministic title with a written one.
 *
 * Haiku, deliberately. AI_MODELS argues against reaching for a cheaper model
 * on cost-per-*resolved-question* grounds — that argument is about answers.
 * A title has no tools, no scoping and no correctness stake: the worst outcome
 * is a slightly clumsy label on a row the user can rename.
 *
 * Best-effort throughout. Every failure path leaves the fallback title in
 * place, which is why none of them throw — but they all log, because a wrong
 * model id in a path nothing awaits is otherwise completely silent.
 */
export async function generateTitle(
  admin: SupabaseClient,
  conversationId: string,
  question: string
): Promise<void> {
  if (!isAiConfigured()) return;

  try {
    const response = await getAiClient().messages.create({
      model: AI_MODELS.title,
      max_tokens: 24,
      system:
        "You name conversations in a school-office ERP. Reply with a 3-6 word " +
        "title for the question, and nothing else. Sentence case. No quotes, " +
        "no trailing period, no preamble. Use school vocabulary: class, " +
        "section, session, admission number, dues.",
      messages: [{ role: "user", content: question.slice(0, 500) }],
    });

    const title = response.content
      .filter((b): b is { type: "text"; text: string; citations: never } =>
        b.type === "text"
      )
      .map((b) => b.text)
      .join(" ")
      .trim()
      .replace(/^["'`]+|["'`]+$/g, "")
      .replace(/\.$/, "")
      .slice(0, MAX_TITLE)
      .trim();

    if (!title) return;

    // Only while nobody has renamed it. A user who typed their own name for
    // this chat between the first reply and this update must win — they were
    // looking at the row, and having it change under them is worse than a
    // clumsy auto-title.
    const { error } = await admin
      .from("ai_conversations")
      .update({ title, title_source: "auto" })
      .eq("id", conversationId)
      .neq("title_source", "user");

    if (error) console.error("[ai.title] update failed:", error.message);
  } catch (err) {
    console.error("[ai.title] generation failed:", err);
  }
}
