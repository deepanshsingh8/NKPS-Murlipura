import { createUploadUrlHandler } from "@nkps/shared/lib/upload-url-handler";

// CMS-side signed-upload-URL endpoint. ERP has its own /api/upload-url for
// staff-photos. Other buckets (gallery, site-media, transfer-certificates,
// disclosure-documents) are CMS-only.
const BUCKET_RULES = {
  gallery: {
    exts: ["jpg", "jpeg", "png", "webp"],
    description: "gallery images",
  },
  "site-media": {
    exts: ["jpg", "jpeg", "png", "webp", "svg"],
    description: "site media assets",
  },
  "transfer-certificates": {
    exts: ["pdf"],
    description: "transfer certificate PDFs",
  },
  "disclosure-documents": {
    exts: ["pdf"],
    description: "mandatory public disclosure PDFs",
  },
  prospectus: {
    exts: ["pdf"],
    description: "prospectus PDFs",
  },
  "holiday-homework": {
    exts: ["pdf"],
    description: "holiday homework PDFs",
  },
};

export const POST = createUploadUrlHandler({ bucketRules: BUCKET_RULES });
