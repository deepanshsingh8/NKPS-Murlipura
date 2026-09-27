import { NextRequest, NextResponse } from "next/server";
import { verifyAdminOrEditorWithUser } from "@nkps/shared/lib/verify-admin";
import { loadOwnedConversation, loadTranscript } from "@/lib/ai/conversations";

export const runtime = "nodejs";

/**
 * One chat: read it, rename it, remove it.
 *
 * Every handler resolves the conversation through loadOwnedConversation, which
 * returns null for "not yours" and "no such id" alike — so all three answer
 * 404 and none of them confirms that someone else's chat exists.
 */

const NOT_FOUND = { error: "That chat is no longer available." };

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const caller = await verifyAdminOrEditorWithUser("reports");
  if (!caller) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const conversation = await loadOwnedConversation(caller.admin, id, caller.user.id);
  if (!conversation) return NextResponse.json(NOT_FOUND, { status: 404 });

  const turns = await loadTranscript(caller.admin, id);

  return NextResponse.json({
    conversation: {
      id: conversation.id,
      title: conversation.title,
      started_at: conversation.started_at,
      last_at: conversation.last_at,
      status: conversation.status,
    },
    turns,
  });
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const caller = await verifyAdminOrEditorWithUser("reports");
  if (!caller) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;

  let body: { title?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const title = typeof body.title === "string" ? body.title.trim().slice(0, 120) : "";
  if (!title) {
    return NextResponse.json({ error: "Give the chat a name." }, { status: 400 });
  }

  // Ownership is in the WHERE clause, not a prior read: one statement, no
  // window between checking and writing.
  //
  // last_at is deliberately NOT touched. Renaming a chat must not jump it to
  // the top of a list ordered by when it was last *used*.
  const { data, error } = await caller.admin
    .from("ai_conversations")
    .update({ title, title_source: "user" })
    .eq("id", id)
    .eq("actor_id", caller.user.id)
    .is("deleted_at", null)
    .select("id, title")
    .maybeSingle();

  if (error) {
    console.error("[ai.conversations] rename:", error.message);
    return NextResponse.json({ error: "Couldn't rename that chat." }, { status: 500 });
  }
  if (!data) return NextResponse.json(NOT_FOUND, { status: 404 });

  return NextResponse.json({ id: data.id, title: data.title });
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const caller = await verifyAdminOrEditorWithUser("reports");
  if (!caller) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;

  // ── Hide first, then redact. The order is the whole design ────────────────
  // A crash between the two must leave a chat that is hidden but still holds
  // its text, never one that is visible but blank. The first outcome is a
  // delete that finished its user-visible job; the second is a chat the user
  // still sees with its contents mysteriously gone.
  const { data, error } = await caller.admin
    .from("ai_conversations")
    .update({ deleted_at: new Date().toISOString(), deleted_by: caller.user.id })
    .eq("id", id)
    .eq("actor_id", caller.user.id)
    .is("deleted_at", null)
    .select("id")
    .maybeSingle();

  if (error) {
    console.error("[ai.conversations] delete:", error.message);
    return NextResponse.json({ error: "Couldn't delete that chat." }, { status: 500 });
  }
  if (!data) return NextResponse.json(NOT_FOUND, { status: 404 });

  // The words go; the skeleton stays. ai_tool_calls and ai_query_runs are
  // untouched on purpose — what an auditor needs to answer "did the assistant
  // read something it shouldn't have?" lives there, and tidying a chat list
  // must not be a way to erase it.
  const redaction = await caller.admin
    .from("ai_messages")
    .update({ content: null, redacted_at: new Date().toISOString() })
    .eq("conversation_id", id)
    .not("content", "is", null);

  if (redaction.error) {
    console.error("[ai.conversations] redact:", redaction.error.message);
  }

  return NextResponse.json({ ok: true, redacted: !redaction.error });
}
