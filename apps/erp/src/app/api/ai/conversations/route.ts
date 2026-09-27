import { NextRequest, NextResponse } from "next/server";
import { verifyAdminOrEditorWithUser } from "@nkps/shared/lib/verify-admin";
import { listConversations } from "@/lib/ai/conversations";

export const runtime = "nodejs";

/**
 * GET /api/ai/conversations — the caller's own Ask chats.
 *
 * Gated on `reports`, the same grant as the page itself: this lists the
 * questions someone asked of the student master, so it must be no easier to
 * reach than the master.
 *
 * There is no admin override and there should not be one. An admin who needs
 * to audit what was asked has the ai_* tables; giving this endpoint a
 * "show me everyone's" mode would turn a personal history list into a
 * surveillance surface with no screen behind it.
 */
export async function GET(request: NextRequest) {
  const caller = await verifyAdminOrEditorWithUser("reports");
  if (!caller) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const limit = Math.min(50, Math.max(1, Number(url.searchParams.get("limit") ?? 30) || 30));
  const before = url.searchParams.get("before") ?? undefined;
  const q = url.searchParams.get("q") ?? undefined;

  const { conversations, next_cursor } = await listConversations(
    caller.admin,
    caller.user.id,
    { limit, before, q }
  );

  return NextResponse.json({ conversations, next_cursor });
}
