import { createUploadUrlHandler } from "@nkps/shared/lib/upload-url-handler";

// ERP-side signed-upload-URL endpoint. Used by the staff page for staff
// profile photos. Avatar uploads go through /api/portal/avatar instead
// (server-side direct upload, no signed URL needed).
const BUCKET_RULES = {
  "staff-photos": {
    // webp included because uploadToStorage re-encodes raster photos to WebP
    // client-side before minting the signed URL.
    exts: ["jpg", "jpeg", "png", "webp"],
    description: "staff profile photos (JPG/PNG/WebP, ≤2 MB, 4:5 portrait)",
    featureKey: "staff" as const,
  },
  "transport-applications": {
    // Office-uploaded scanned applications backing a transport change request.
    exts: ["pdf", "jpg", "jpeg", "png"],
    description: "transport change-request applications (PDF/JPG/PNG, ≤10 MB)",
    featureKey: "transport" as const,
  },
};

export const POST = createUploadUrlHandler({ bucketRules: BUCKET_RULES });
