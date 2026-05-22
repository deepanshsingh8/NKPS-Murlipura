// Resolve a Supabase Storage object path from a stored URL or path string.
//
// Many CMS/ERP rows store the public URL of an uploaded asset (with cache
// busters like `?t=...`, signed-URL params, or path segments after the
// object name). Naively taking the last path segment as the filename
// silently no-ops when callers try to delete the underlying object.
// (Audit L2.)
//
// Returns the URL-decoded object path within the given bucket, or null if
// the input doesn't reference that bucket.

export function extractStoragePath(
  fileUrl: string | null | undefined,
  bucket: string
): string | null {
  if (!fileUrl) return null;
  const trimmed = fileUrl.trim();
  if (!trimmed) return null;
  // Already-relative path. Strip leading slashes; ignore query string if any.
  if (!trimmed.startsWith("http://") && !trimmed.startsWith("https://")) {
    const noQuery = trimmed.split("?")[0];
    return noQuery.replace(/^\/+/, "");
  }
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return null;
  }
  const re = /\/storage\/v1\/object\/(?:public|sign)\/([^/]+)\/(.+)$/;
  const m = parsed.pathname.match(re);
  if (!m) return null;
  if (m[1] !== bucket) return null;
  return decodeURIComponent(m[2]);
}
