import { NextResponse } from "next/server";
import { z } from "zod";
import { resolveDiaryCaller, visibilityFilter } from "@/lib/class-diary";

// POST /api/class-diary/read — { post_ids } → marks them read for this
// parent or student. Only ids the caller can actually see are recorded, so a
// receipt count can never be inflated with posts from someone else's class.

const bodySchema = z.object({
  post_ids: z.array(z.string().uuid()).min(1).max(100),
});

export async function POST(request: Request) {
  const caller = await resolveDiaryCaller();
  if (!caller) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (caller.kind !== "portal") return NextResponse.json({ ok: true, marked: 0 });

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid data" }, { status: 400 });
  }

  const { data: visible } = await caller.admin
    .from("class_diary_posts")
    .select("id")
    .in("id", parsed.data.post_ids)
    .or(visibilityFilter(caller));

  const rows = (visible ?? []).map((p) => ({
    post_id: p.id as string,
    profile_id: caller.userId,
  }));
  if (rows.length === 0) return NextResponse.json({ ok: true, marked: 0 });

  const { error } = await caller.admin
    .from("class_diary_reads")
    .upsert(rows, { onConflict: "post_id,profile_id", ignoreDuplicates: true });
  if (error) {
    console.error("[class-diary.read]", error);
    return NextResponse.json({ error: "Failed to record" }, { status: 500 });
  }
  return NextResponse.json({ ok: true, marked: rows.length });
}
