import { createUploadUrlHandler } from "@nkps/shared/lib/upload-url-handler";

// CMS-side signed-upload-URL endpoint. ERP has its own /api/upload-url for
// staff-photos. Other buckets (gallery, site-media, transfer-certificates,
// disclosure-documents) are CMS-only.
// NOTE: `svg` is intentionally NOT allowed. SVGs can carry inline <script>
// and execute when served from the public bucket origin (stored XSS). If SVG
// support is ever needed, sanitize server-side (DOMPurify SVG profile) and
// serve with Content-Disposition: attachment + a sandbox CSP.
const BUCKET_RULES = {
  gallery: {
    exts: ["jpg", "jpeg", "png", "webp"],
    description: "gallery images",
    featureKey: "gallery" as const,
  },
  "site-media": {
    exts: ["jpg", "jpeg", "png", "webp"],
    description: "site media assets",
    featureKey: "site_media" as const,
  },
  "transfer-certificates": {
    exts: ["pdf"],
    description: "transfer certificate PDFs",
    featureKey: "transfer_certificates" as const,
  },
  "disclosure-documents": {
    exts: ["pdf"],
    description: "mandatory public disclosure PDFs",
    featureKey: "disclosure" as const,
  },
};

export const POST = createUploadUrlHandler({ bucketRules: BUCKET_RULES });
