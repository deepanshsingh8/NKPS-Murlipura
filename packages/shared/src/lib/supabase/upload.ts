import { createClient } from "./client";
import { adminFetch } from "@nkps/shared/lib/admin-api";
import { compressImage, swapToWebpExtension } from "@nkps/shared/lib/image-compress";

// Supabase Storage rejects an object whose content-type is missing from the
// bucket's `allowed_mime_types` with exactly this message. Matched (rather
// than plumbed through as a status code) because uploadToSignedUrl only hands
// back the message string.
function isUnsupportedMimeError(message: string): boolean {
  return /mime type .+ is not supported/i.test(message);
}

async function signAndUpload(
  bucket: string,
  objectName: string,
  file: File
): Promise<{ publicUrl: string; error: { message: string } | null }> {
  // 1. Get a signed upload URL from the server.
  // Each app exposes /api/upload-url at its root (signed-URL generator).
  const res = await adminFetch("/api/upload-url", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ bucket, fileName: objectName }),
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
    .uploadToSignedUrl(objectName, token, file, {
      contentType: file.type,
      cacheControl: "31536000",
    });

  return { publicUrl, error };
}

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
  // Optimize images before we even mint the signed URL, so the URL is
  // requested with the final (possibly `.webp`) name and the server's
  // extension allowlist sees the real upload.
  const optimized = await compressImage(file);
  const uploadName =
    optimized === file ? fileName : swapToWebpExtension(fileName);

  const first = await signAndUpload(bucket, uploadName, optimized);
  if (!first.error) return first.publicUrl;

  // A bucket whose `allowed_mime_types` predates the WebP re-encode rejects
  // the optimized upload ("mime type image/webp is not supported") even though
  // the file the admin picked was a perfectly valid JPG/PNG. Storage config is
  // deployed separately from this code, so don't fail an otherwise-valid
  // upload on it: retry once with the untouched original, under its original
  // extension. The upload is then unoptimized but it goes through.
  if (optimized !== file && isUnsupportedMimeError(first.error.message)) {
    const retry = await signAndUpload(bucket, fileName, file);
    if (!retry.error) return retry.publicUrl;
    throw new Error(retry.error.message);
  }

  throw new Error(first.error.message);
}
