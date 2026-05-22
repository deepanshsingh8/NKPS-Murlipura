import { NextResponse, type NextRequest } from "next/server";
import { rateLimit, clientIp } from "@nkps/shared/lib/rate-limit";
import { verifyAdminOrEditor } from "@nkps/shared/lib/verify-admin";

// Bucket name is constant — defined here once so the path-extraction logic
// below stays in sync with the upload routes.
const TC_BUCKET = "transfer-certificates";
const SIGNED_URL_TTL_SECONDS = 60;

/**
 * Resolve the storage path inside the `transfer-certificates` bucket from a
 * stored `file_url`. We accept three formats so the table doesn't need to be
 * migrated:
 *
 *   1. Bare filename (new uploads) — `1730000000-john-doe.pdf`
 *   2. Public Supabase URL — `https://<project>.supabase.co/storage/v1/object/public/transfer-certificates/<path>`
 *   3. Signed Supabase URL — `https://<project>.supabase.co/storage/v1/object/sign/transfer-certificates/<path>?token=…`
 *
 * Returns null if the URL doesn't reference our bucket — at which point the
 * download endpoint should 404 rather than redirect to an arbitrary location.
 */
function extractBucketPath(fileUrl: string): string | null {
  const trimmed = fileUrl.trim();
  if (!trimmed) return null;

  // Bare filename — no scheme, no slashes (or just one). Store-as-path pattern.
  if (!trimmed.startsWith("http://") && !trimmed.startsWith("https://")) {
    return trimmed.replace(/^\/+/, "");
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return null;
  }

  // Match either `/storage/v1/object/public/transfer-certificates/<path>` or
  // `/storage/v1/object/sign/transfer-certificates/<path>`.
  const re = /\/storage\/v1\/object\/(?:public|sign)\/([^/]+)\/(.+)$/;
  const m = parsed.pathname.match(re);
  if (!m) return null;
  if (m[1] !== TC_BUCKET) return null;
  return decodeURIComponent(m[2]);
}

/**
 * GET /api/transfer-certificates/[id]/download
 *
 * Admin-only endpoint. The public TC flow goes through the lookup endpoint
 * which gates by (admission_no, dob) and returns the signed URL inline —
 * downloading by id alone is never exposed to the public, so any caller
 * here must be an authenticated admin or editor with TC permission.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const admin = await verifyAdminOrEditor("transfer_certificates");
  if (!admin) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const ipLimit = rateLimit({
    name: "tc-download:ip",
    key: clientIp(request),
    max: 30,
    windowSeconds: 60 * 60,
  });
  if (!ipLimit.ok) {
    return NextResponse.json(
      { error: "Too many download requests. Please try again later." },
      { status: 429 }
    );
  }

  const { id } = await params;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    return NextResponse.json({ error: "Invalid TC id" }, { status: 400 });
  }
  const { data: tc, error } = await admin
    .from("transfer_certificates")
    .select("id, file_url, student_name")
    .eq("id", id)
    .maybeSingle();

  if (error) {
    console.error("[TC download] DB lookup error:", error);
    return NextResponse.json(
      { error: "Failed to load certificate" },
      { status: 500 }
    );
  }
  if (!tc) {
    return NextResponse.json({ error: "Certificate not found" }, { status: 404 });
  }

  const path = extractBucketPath((tc.file_url as string) ?? "");
  if (!path) {
    console.error("[TC download] Could not extract path from file_url:", tc.file_url);
    return NextResponse.json(
      { error: "Certificate file is unavailable" },
      { status: 500 }
    );
  }

  const { data: signed, error: signErr } = await admin.storage
    .from(TC_BUCKET)
    .createSignedUrl(path, SIGNED_URL_TTL_SECONDS, {
      download: `${tc.student_name}.pdf`.replace(/[^\w\-. ]+/g, "_"),
    });

  if (signErr || !signed?.signedUrl) {
    console.error("[TC download] Sign error:", signErr);
    return NextResponse.json(
      { error: "Failed to generate download URL" },
      { status: 500 }
    );
  }

  console.info(
    `[TC download] id=${id} ip=${clientIp(request)} path=${path}`
  );
  return NextResponse.json({
    signedUrl: signed.signedUrl,
    expiresInSeconds: SIGNED_URL_TTL_SECONDS,
  });
}
