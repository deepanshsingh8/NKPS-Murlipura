// SSRF-resistant fetch helpers.
//
// Server-rendered PDFs pull student photos by URL stored in the DB. A
// compromised admin (or a future bug in input validation) could write any
// URL — `http://localhost:6789`, `http://169.254.169.254/...` (cloud
// metadata), `file://...`, etc. — and trick the server into hitting it.
//
// The helpers below restrict outbound fetches to:
//  - https only (no http, file://, gopher://, ftp://, data: …)
//  - hosts on an allowlist (currently the configured Supabase Storage host
//    plus a small fallback)
//  - bounded body size (10 MB) and request timeout (5 s)

const DEFAULT_TIMEOUT_MS = 5_000;
const DEFAULT_MAX_BYTES = 10 * 1024 * 1024;

let cachedAllowedHosts: Set<string> | null = null;

function buildAllowedHosts(): Set<string> {
  if (cachedAllowedHosts) return cachedAllowedHosts;
  const hosts = new Set<string>();
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (supabaseUrl) {
    try {
      hosts.add(new URL(supabaseUrl).host);
    } catch {
      // ignored — bad env, just means we end up with a tighter allowlist.
    }
  }
  // Operators can extend the list via env, comma-separated.
  const extra = process.env.SAFE_FETCH_ALLOWED_HOSTS;
  if (extra) {
    for (const h of extra.split(",")) {
      const t = h.trim();
      if (t) hosts.add(t);
    }
  }
  cachedAllowedHosts = hosts;
  return hosts;
}

export interface SafeFetchOptions {
  timeoutMs?: number;
  maxBytes?: number;
}

/**
 * Fetch a remote URL into a Buffer, returning null on any policy violation
 * or network error. Never throws — callers can render a fallback.
 */
export async function safeFetchBuffer(
  rawUrl: string | null | undefined,
  opts: SafeFetchOptions = {}
): Promise<Buffer | null> {
  if (!rawUrl) return null;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxBytes = opts.maxBytes ?? DEFAULT_MAX_BYTES;

  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return null;
  }

  if (parsed.protocol !== "https:") return null;

  const allowed = buildAllowedHosts();
  // If no allowlist is configured at all, fail closed — we'd rather drop a
  // photo than open an SSRF vector.
  if (allowed.size === 0) return null;
  if (!allowed.has(parsed.host)) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(parsed.toString(), {
      signal: controller.signal,
      redirect: "error", // refuse redirects (they can land on disallowed hosts)
    });
    if (!res.ok) return null;

    const contentLength = res.headers.get("content-length");
    if (contentLength && Number(contentLength) > maxBytes) return null;

    const arrayBuf = await res.arrayBuffer();
    if (arrayBuf.byteLength > maxBytes) return null;
    return Buffer.from(arrayBuf);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
