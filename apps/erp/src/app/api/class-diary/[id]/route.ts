import { NextResponse } from "next/server";
import type { createAdminClient } from "@nkps/shared/lib/supabase/admin";
import {
  DIARY_BUCKET,
  attachmentsAllowed,
  canModify,
  diaryUpdateSchema,
  resolveDiaryCaller,
  type DiaryAttachment,
} from "@/lib/class-diary";

// PATCH  /api/class-diary/[id] — edit one post (its author, or the office).
// DELETE /api/class-diary/[id] — remove one post, and any attachment no other
//                                post still points at.

type Admin = ReturnType<typeof createAdminClient>;

async function loadPost(admin: Admin, id: string) {
  const { data } = await admin
    .from("class_diary_posts")
    .select("id, class_id, created_by, post_date, due_date, attachments")
    .eq("id", id)
    .maybeSingle();
  return data as
    | {
        id: string;
        class_id: string | null;
        created_by: string | null;
        post_date: string;
        due_date: string | null;
        attachments: DiaryAttachment[];
      }
    | null;
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const caller = await resolveDiaryCaller();
  if (!caller) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const post = await loadPost(caller.admin, id);
  if (!post) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!canModify(caller, post)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const parsed = diaryUpdateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return NextResponse.json({ error: first?.message ?? "Invalid data" }, { status: 400 });
  }
  const patch = parsed.data;

  // Attachments already on the post may stay whoever uploaded them; only
  // newly added paths have to be the caller's own.
  if (patch.attachments) {
    const existing = new Set(post.attachments.map((a) => a.path));
    const added = patch.attachments.filter((a) => !existing.has(a.path));
    if (!attachmentsAllowed(caller, added)) {
      return NextResponse.json({ error: "Invalid attachment" }, { status: 400 });
    }
  }

  const postDate = patch.post_date ?? post.post_date;
  const dueDate = patch.due_date === undefined ? post.due_date : patch.due_date;
  if (dueDate && dueDate < postDate) {
    return NextResponse.json(
      { error: "The due date is before the post date" },
      { status: 400 }
    );
  }

  const update: Record<string, unknown> = { ...patch };
  if (typeof update.body === "string") update.body = (update.body as string).trim();
  if (caller.kind !== "staff") delete update.is_pinned;

  const { error } = await caller.admin
    .from("class_diary_posts")
    .update(update)
    .eq("id", id);
  if (error) {
    console.error("[class-diary.PATCH] update:", error);
    return NextResponse.json({ error: "Failed to save" }, { status: 500 });
  }

  if (patch.attachments) {
    const kept = new Set(patch.attachments.map((a) => a.path));
    await removeOrphans(
      caller.admin,
      post.attachments.map((a) => a.path).filter((p) => !kept.has(p))
    );
  }
  return NextResponse.json({ ok: true });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const caller = await resolveDiaryCaller();
  if (!caller) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const post = await loadPost(caller.admin, id);
  if (!post) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!canModify(caller, post)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { error } = await caller.admin.from("class_diary_posts").delete().eq("id", id);
  if (error) {
    console.error("[class-diary.DELETE] delete:", error);
    return NextResponse.json({ error: "Failed to delete" }, { status: 500 });
  }
  await removeOrphans(caller.admin, post.attachments.map((a) => a.path));
  return NextResponse.json({ ok: true });
}

/**
 * Delete storage objects no remaining post references. A post sent to three
 * sections shares its files across three rows, so deleting one section's copy
 * must leave the others' photos in place.
 */
async function removeOrphans(admin: Admin, paths: string[]) {
  const orphans: string[] = [];
  for (const path of new Set(paths)) {
    const { count } = await admin
      .from("class_diary_posts")
      .select("id", { count: "exact", head: true })
      .contains("attachments", JSON.stringify([{ path }]));
    if (!count) orphans.push(path);
  }
  if (orphans.length > 0) {
    const { error } = await admin.storage.from(DIARY_BUCKET).remove(orphans);
    // The post is already gone; an orphaned file costs storage, not access.
    if (error) console.error("[class-diary] orphan cleanup:", error);
  }
}
