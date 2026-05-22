/**
 * Single source of truth for student/staff photograph specs.
 *
 * §1 of the school feature requirements: surface this spec in the upload UI
 * BEFORE the user picks a file, validate on the client, and render at 4:5
 * portrait everywhere so A4-shaped uploads are not center-cropped.
 */

export const PHOTO_SPEC = {
  recommendedWidth: 1200,
  recommendedHeight: 1500,
  /** Width / height ratio: 4:5 portrait. */
  aspectRatio: 4 / 5,
  maxSizeMB: 2,
  acceptedFormats: ["image/jpeg", "image/jpg", "image/png"] as const,
  acceptedExtensions: [".jpg", ".jpeg", ".png"] as const,
} as const;

export const PHOTO_SPEC_HELPER_TEXT =
  "JPG or PNG, up to 2 MB. Recommended: 1200 × 1500 px (4:5 portrait).";

export type PhotoValidationResult =
  | { ok: true }
  | { ok: false; reason: string };

/**
 * Validate a chosen file against the photograph spec.
 * Used by upload forms before passing the file on to the cropper / uploader.
 */
export function validatePhotoFile(file: File): PhotoValidationResult {
  const maxBytes = PHOTO_SPEC.maxSizeMB * 1024 * 1024;
  if (file.size > maxBytes) {
    const sizeMB = (file.size / (1024 * 1024)).toFixed(1);
    return {
      ok: false,
      reason: `Image is ${sizeMB} MB. Max allowed is ${PHOTO_SPEC.maxSizeMB} MB.`,
    };
  }

  const isAcceptedMime =
    file.type && (PHOTO_SPEC.acceptedFormats as readonly string[]).includes(file.type);
  // Some browsers don't fill `file.type` for older formats — fall back to extension.
  const lowerName = file.name.toLowerCase();
  const isAcceptedExt = PHOTO_SPEC.acceptedExtensions.some((ext) =>
    lowerName.endsWith(ext)
  );

  if (!isAcceptedMime && !isAcceptedExt) {
    return {
      ok: false,
      reason: "Only JPG and PNG images are allowed.",
    };
  }

  return { ok: true };
}
