import { NextRequest, NextResponse } from "next/server";
import { verifyAdminOrEditorWithUser } from "@nkps/shared/lib/verify-admin";
import type { FeatureKey } from "@nkps/shared/lib/permissions";
import { rateLimit } from "@nkps/shared/lib/rate-limit";

// Generic signed-upload-URL handler. Each app (apps/cms, apps/erp) mounts its
// own /api/upload-url route as a thin wrapper that calls
// createUploadUrlHandler with its own bucket allowlist. Keeping the handler
// here ensures both apps stay in lockstep on auth, validation, and signing.

// Max signed-URL mints per actor per hour. Bounds quota/egress abuse from a
// compromised or curious editor account.
const MAX_MINTS_PER_HOUR = 120;

export interface BucketRule {
  exts: string[];
  description: string;
  // Editor capability required to upload to this bucket. Admins always pass.
  // Required so an editor with an unrelated grant can't mint URLs for a bucket
  // they have no business writing to.
  featureKey: FeatureKey;
}

export interface UploadUrlConfig {
  // Buckets the calling app's UI is allowed to upload to. Any bucket not
  // listed here will be rejected with 403.
  bucketRules: Record<string, BucketRule>;
}

function fileExtension(name: string): string | null {
  const m = name.toLowerCase().match(/\.([a-z0-9]+)$/);
  return m ? m[1]! : null;
}

export function createUploadUrlHandler(config: UploadUrlConfig) {
  const { bucketRules } = config;

  return async function POST(request: NextRequest) {
    let body: { bucket?: unknown; fileName?: unknown };
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    }

    const { bucket, fileName } = body;

    if (!bucket || !fileName) {
      return NextResponse.json(
        { error: "Missing bucket or fileName" },
        { status: 400 }
      );
    }

    if (typeof bucket !== "string" || typeof fileName !== "string") {
      return NextResponse.json(
        { error: "bucket and fileName must be strings" },
        { status: 400 }
      );
    }

    const rule = bucketRules[bucket];
    if (!rule) {
      return NextResponse.json(
        { error: `Uploads to '${bucket}' are not allowed` },
        { status: 403 }
      );
    }

    // Authorize against the capability THIS bucket requires (not just "any
    // editor"). Admins bypass; editors need the matching grant.
    const auth = await verifyAdminOrEditorWithUser(rule.featureKey);
    if (!auth) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const { admin, user } = auth;

    const limit = rateLimit({
      name: "upload-url",
      key: user.id,
      max: MAX_MINTS_PER_HOUR,
      windowSeconds: 3600,
    });
    if (!limit.ok) {
      return NextResponse.json(
        { error: "Too many upload requests. Try again later." },
        { status: 429 }
      );
    }

    try {
      // Reject path traversal and absolute paths up front. Storage paths must
      // be a flat filename or a forward-slash path with no `..` segments.
      if (
        fileName.includes("..") ||
        fileName.startsWith("/") ||
        fileName.includes("\\")
      ) {
        return NextResponse.json(
          { error: "Invalid fileName" },
          { status: 400 }
        );
      }

      const ext = fileExtension(fileName);
      if (!ext || !rule.exts.includes(ext)) {
        return NextResponse.json(
          {
            error: `'${ext ?? "?"}' isn't a permitted extension for ${rule.description}. Allowed: ${rule.exts.join(", ")}`,
          },
          { status: 415 }
        );
      }

      const { data, error } = await admin.storage
        .from(bucket)
        .createSignedUploadUrl(fileName);

      if (error) {
        console.error("Signed upload URL error:", error);
        return NextResponse.json(
          { error: "Failed to create upload URL" },
          { status: 500 }
        );
      }

      const {
        data: { publicUrl },
      } = admin.storage.from(bucket).getPublicUrl(fileName);

      return NextResponse.json({
        signedUrl: data.signedUrl,
        token: data.token,
        path: data.path,
        publicUrl,
      });
    } catch {
      return NextResponse.json(
        { error: "Unexpected error" },
        { status: 500 }
      );
    }
  };
}
