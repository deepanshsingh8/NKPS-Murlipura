import { createClient } from "./client";
import { adminFetch } from "@nkps/shared/lib/admin-api";

/**
 * Upload a file directly to Supabase Storage from the browser.
 * Uses a signed upload URL generated server-side (admin client) to bypass
 * both Vercel's 4.5MB body size limit and storage RLS policies.
 * Returns the public URL of the uploaded file.
 */
export async function uploadToStorage(
  bucket: string,
  fileName: string,
  file: File
): Promise<string> {
  // 1. Get a signed upload URL from the server
  // Each app exposes /api/upload-url at its root (signed-URL generator).
  // Currently only apps/cms needs this (uploads to gallery / TC / site-media
  // / disclosure-documents / staff-photos buckets).
  const res = await adminFetch("/api/upload-url", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ bucket, fileName }),
  });

  if (!res.ok) {
    const data = await res.json();
    throw new Error(data.error || "Failed to get upload URL");
  }

  const { token, publicUrl } = await res.json();

  // 2. Upload directly to Supabase Storage using the signed URL
  const supabase = createClient();
  const { error } = await supabase.storage
    .from(bucket)
    .uploadToSignedUrl(fileName, token, file, {
      contentType: file.type,
    });

  if (error) {
    throw new Error(error.message);
  }

  return publicUrl;
}
