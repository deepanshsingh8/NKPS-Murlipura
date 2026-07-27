import { createClient } from "./client";
import { adminFetch } from "@nkps/shared/lib/admin-api";
import { compressImage, swapToWebpExtension } from "@nkps/shared/lib/image-compress";

/**
 * Upload a file directly to Supabase Storage from the browser.
 * Uses a signed upload URL generated server-side (admin client) to bypass
 * both Vercel's 4.5MB body size limit and storage RLS policies.
 * Returns the public URL of the uploaded file.
 *
 * Raster images are downscaled + re-encoded to WebP first (see compressImage);
 * when that happens the stored object's extension becomes `.webp`, so the
 * returned publicUrl reflects the optimized file. Non-image files (PDFs) pass
 * through untouched.
 */
export async function uploadToStorage(
  bucket: string,
  fileName: string,
  file: File
): Promise<string> {
  // 0. Optimize images before we even mint the signed URL, so the URL is
  // requested with the final (possibly `.webp`) name and the server's
  // extension allowlist sees the real upload.
  const optimized = await compressImage(file);
  const uploadName =
    optimized === file ? fileName : swapToWebpExtension(fileName);

  // 1. Get a signed upload URL from the server
  // Each app exposes /api/upload-url at its root (signed-URL generator).
  // Currently only apps/cms needs this (uploads to gallery / TC / site-media
  // / disclosure-documents / staff-photos buckets).
  const res = await adminFetch("/api/upload-url", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ bucket, fileName: uploadName }),
  });

  if (!res.ok) {
    const data = await res.json();
    throw new Error(data.error || "Failed to get upload URL");
  }

  const { token, publicUrl } = await res.json();

  // 2. Upload directly to Supabase Storage using the signed URL.
  // cacheControl: 1 year — these are immutable, content-addressed-ish uploads
  // (unique timestamped names), so a long TTL fixes Lighthouse's "efficient
  // cache lifetimes" without risking stale assets.
  const supabase = createClient();
  const { error } = await supabase.storage
    .from(bucket)
    .uploadToSignedUrl(uploadName, token, optimized, {
      contentType: optimized.type,
      cacheControl: "31536000",
    });

  if (error) {
    throw new Error(error.message);
  }

  return publicUrl;
}
