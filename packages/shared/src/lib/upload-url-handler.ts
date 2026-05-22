import { NextRequest, NextResponse } from "next/server";
import { verifyAdminOrEditor } from "@nkps/shared/lib/verify-admin";

// Generic signed-upload-URL handler. Each app (apps/cms, apps/erp) mounts its
// own /api/upload-url route as a thin wrapper that calls
// createUploadUrlHandler with its own bucket allowlist. Keeping the handler
// here ensures both apps stay in lockstep on auth, validation, and signing.

export interface BucketRule {
  exts: string[];
  description: string;
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
    const admin = await verifyAdminOrEditor();
    if (!admin) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    try {
      const { bucket, fileName } = await request.json();

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
