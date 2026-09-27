/**
 * Client-side helper for admin operations.
 * Routes through /api/admin which uses the service role client (bypasses RLS).
 * Passes the Supabase access token in the Authorization header.
 */

import { createClient } from "@nkps/shared/lib/supabase/client";
import type { DependencyReport } from "@nkps/shared/lib/row-dependencies";

interface AdminApiOptions {
  action: "insert" | "update" | "delete";
  table: string;
  data?: Record<string, unknown>;
  match?: { column: string; value: unknown };
}

interface AdminApiResult {
  success: boolean;
  data?: unknown;
  error?: string;
}

async function getAccessToken(): Promise<string | null> {
  const supabase = createClient();
  const { data: { session } } = await supabase.auth.getSession();
  return session?.access_token ?? null;
}

export async function adminApi(options: AdminApiOptions): Promise<AdminApiResult> {
  const token = await getAccessToken();
  if (!token) {
    return { success: false, error: "Not authenticated" };
  }

  const res = await fetch("/api/admin", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${token}`,
    },
    body: JSON.stringify(options),
  });

  const result = await res.json();

  if (!res.ok) {
    return { success: false, error: result.error || "Request failed" };
  }

  return { success: true, data: result.data };
}

/**
 * Asks the server what a master row is still holding up, before offering to
 * delete it. Returns null when the check itself fails — callers treat that as
 * "unknown" and fall back to a generic confirmation; the proxy still refuses
 * the delete server-side, so a failed pre-flight can only cost a nicer message,
 * never safety.
 */
export async function fetchRowDependencies(
  table: string,
  id: string
): Promise<DependencyReport | null> {
  try {
    const res = await adminFetch(
      `/api/admin/dependencies?table=${encodeURIComponent(table)}&id=${encodeURIComponent(id)}`
    );
    if (!res.ok) return null;
    return (await res.json()) as DependencyReport;
  } catch {
    return null;
  }
}

/**
 * Fetch helper for admin endpoints. Includes auth token automatically.
 * Supports GET (default) and other methods via options.
 */
export async function adminFetch(url: string, options?: RequestInit): Promise<Response> {
  const token = await getAccessToken();
  const headers = new Headers(options?.headers);
  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }
  return fetch(url, { ...options, headers });
}

/**
 * Fetch helper for admin POST endpoints with FormData. Includes auth token.
 */
export async function adminUpload(url: string, formData: FormData, method: "POST" | "PATCH" = "POST"): Promise<Response> {
  const token = await getAccessToken();
  return fetch(url, {
    method,
    headers: token ? { "Authorization": `Bearer ${token}` } : {},
    body: formData,
  });
}

/**
 * Fetch helper for admin PATCH endpoints. Includes auth token.
 */
export async function adminPatch(url: string, body: unknown): Promise<Response> {
  const token = await getAccessToken();
  return fetch(url, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { "Authorization": `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
}

/**
 * Fetch helper for admin DELETE endpoints. Includes auth token.
 */
export async function adminDelete(url: string, body: unknown): Promise<Response> {
  const token = await getAccessToken();
  return fetch(url, {
    method: "DELETE",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { "Authorization": `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
}
