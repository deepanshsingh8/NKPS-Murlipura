import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  DIARY_BUCKET,
  DIARY_FILE_TYPES,
  resolveDiaryCaller,
} from "@/lib/class-diary";

// POST /api/class-diary/upload-url
//
// Mints a signed upload URL into the private class-diary bucket for anyone
// who may post (office or teacher). The shared /api/upload-url is gated on an
// editor feature key, which a teacher posting to their own class does not
// hold, so the diary has its own.
//
// The object path always starts with the caller's user id. That prefix is how
// the create route knows an attachment is the caller's own upload.

const bodySchema = z.object({
  fileName: z.string().min(1).max(200),
  size: z.number().int().positive().max(10 * 1024 * 1024, "Files must be 10 MB or smaller"),
});

export async function POST(request: Request) {
  const caller = await resolveDiaryCaller();
  if (!caller) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (caller.kind === "portal") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return NextResponse.json({ error: first?.message ?? "Invalid data" }, { status: 400 });
  }

  const ext = parsed.data.fileName.split(".").pop()?.toLowerCase() ?? "";
  const contentType = DIARY_FILE_TYPES[ext];
  if (!contentType) {
    return NextResponse.json(
      { error: "Only photos (JPG, PNG, WebP, HEIC) and PDFs can be attached" },
      { status: 400 }
    );
  }

  const month = new Date().toISOString().slice(0, 7);
  const path = `${caller.userId}/${month}/${randomUUID()}.${ext}`;

  const { data, error } = await caller.admin.storage
    .from(DIARY_BUCKET)
    .createSignedUploadUrl(path);
  if (error || !data) {
    console.error("[class-diary.upload-url]", error);
    return NextResponse.json({ error: "Failed to prepare the upload" }, { status: 500 });
  }

  return NextResponse.json({ path, token: data.token, contentType });
}
