import { createUploadUrlHandler } from "@nkps/shared/lib/upload-url-handler";

// ERP-side signed-upload-URL endpoint. Used by the staff page for staff
// profile photos. Avatar uploads go through /api/portal/avatar instead
// (server-side direct upload, no signed URL needed).
const BUCKET_RULES = {
  "staff-photos": {
    exts: ["jpg", "jpeg", "png"],
    description: "staff profile photos (JPG/PNG, ≤2 MB, 4:5 portrait)",
  },
};

export const POST = createUploadUrlHandler({ bucketRules: BUCKET_RULES });
