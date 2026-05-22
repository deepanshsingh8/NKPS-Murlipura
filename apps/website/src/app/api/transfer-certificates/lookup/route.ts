import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@nkps/shared/lib/supabase/admin";
import { rateLimit, clientIp } from "@nkps/shared/lib/rate-limit";

const TC_BUCKET = "transfer-certificates";
const SIGNED_URL_TTL_SECONDS = 60;
// Allow alphanumerics plus common separators schools use (slash, dash, dot,
// space). Anything else is treated as malformed input — we 404 rather than
// querying so the lookup endpoint isn't a probe vector for storage paths.
const ADMISSION_NO_RE = /^[A-Za-z0-9 ./-]{1,32}$/;
const DOB_RE = /^\d{4}-\d{2}-\d{2}$/;

const GENERIC_NO_MATCH = {
  error: "Details don't match any existing TCs",
} as const;

function extractBucketPath(fileUrl: string): string | null {
  const trimmed = fileUrl.trim();
  if (!trimmed) return null;
  if (!trimmed.startsWith("http://") && !trimmed.startsWith("https://")) {
    return trimmed.replace(/^\/+/, "");
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
  if (m[1] !== TC_BUCKET) return null;
  return decodeURIComponent(m[2]);
}

/**
 * POST /api/transfer-certificates/lookup
 *
 * Public, server-only TC lookup. Two factors must match exactly:
 *   - admission_no
 *   - student_dob (YYYY-MM-DD)
 *
 * On miss, the response is a single generic error so we don't leak whether
 * an admission number exists in the system. On hit, the response carries
 * the visible card data (student name, class, academic year) and a
 * short-lived signed URL — no TC ids are ever returned to the client.
 *
 * Rate limited per IP and per admission number to slow enumeration.
 */
export async function POST(request: NextRequest) {
  const ip = clientIp(request);

  const ipLimit = rateLimit({
    name: "tc-lookup:ip",
    key: ip,
    max: 5,
    windowSeconds: 15 * 60,
  });
  if (!ipLimit.ok) {
    return NextResponse.json(
      { error: "Too many lookup attempts. Please try again later." },
      { status: 429 }
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(GENERIC_NO_MATCH, { status: 404 });
  }

  const { admissionNo, dob } = (body ?? {}) as {
    admissionNo?: unknown;
    dob?: unknown;
  };

  if (typeof admissionNo !== "string" || typeof dob !== "string") {
    return NextResponse.json(GENERIC_NO_MATCH, { status: 404 });
  }

  const admNo = admissionNo.trim();
  const dobStr = dob.trim();

  if (!ADMISSION_NO_RE.test(admNo) || !DOB_RE.test(dobStr)) {
    return NextResponse.json(GENERIC_NO_MATCH, { status: 404 });
  }

  // Per-admission_no limiter sits behind the IP limiter so a botnet rotating
  // IPs can't free-fire on a single admission number either.
  const admLimit = rateLimit({
    name: "tc-lookup:adm",
    key: admNo.toLowerCase(),
    max: 5,
    windowSeconds: 15 * 60,
  });
  if (!admLimit.ok) {
    return NextResponse.json(GENERIC_NO_MATCH, { status: 404 });
  }

  const admin = createAdminClient();
  const { data: tc, error } = await admin
    .from("transfer_certificates")
    .select(
      "id, file_url, student_name, class_last_attended, academic_year"
    )
    .eq("admission_no", admNo)
    .eq("student_dob", dobStr)
    .maybeSingle();

  if (error) {
    console.error("[TC lookup] DB error:", error);
    return NextResponse.json(
      { error: "Lookup failed. Please try again." },
      { status: 500 }
    );
  }

  if (!tc) {
    console.info(
      `[TC lookup] miss ip=${ip} admNo=${admNo}`
    );
    return NextResponse.json(GENERIC_NO_MATCH, { status: 404 });
  }

  const path = extractBucketPath((tc.file_url as string) ?? "");
  if (!path) {
    console.error("[TC lookup] Could not extract path from file_url:", tc.file_url);
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
    console.error("[TC lookup] Sign error:", signErr);
    return NextResponse.json(
      { error: "Failed to generate download URL" },
      { status: 500 }
    );
  }

  console.info(`[TC lookup] hit ip=${ip} admNo=${admNo} tc=${tc.id}`);
  return NextResponse.json({
    studentName: tc.student_name,
    classLastAttended: tc.class_last_attended,
    academicYear: tc.academic_year,
    signedUrl: signed.signedUrl,
    expiresInSeconds: SIGNED_URL_TTL_SECONDS,
  });
}
