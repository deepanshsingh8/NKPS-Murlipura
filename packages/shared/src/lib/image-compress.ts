// Client-side image downscale + WebP re-encode, run in the browser *before* a
// file is uploaded so we never store multi-megabyte camera originals (a single
// 1.7 MB hero/section image was tanking the public site's mobile PageSpeed
// score). Caps the longest edge at MAX_EDGE and re-encodes to WebP, which
// preserves transparency and is ~25-35% smaller than JPEG/PNG.
//
// Deliberately conservative: anything that isn't a raster photo type (PDF, SVG,
// GIF, HEIC, …) is returned untouched, and if re-encoding ever fails or doesn't
// actually shrink the file, the original is returned. Callers can therefore
// pass any File through this without special-casing.

const MAX_EDGE = 1920;
const QUALITY = 0.82;

// Only these are safe to rasterize→WebP via <canvas>. GIF is excluded because
// canvas would flatten animation; SVG because rasterizing loses scalability
// (and SVG isn't an allowed upload type anyway).
const COMPRESSIBLE = new Set(["image/jpeg", "image/png", "image/webp"]);

/**
 * Rename a file/object name to `.webp`. Only a trailing alphanumeric extension
 * is stripped — the pattern can't cross a `/` or `-`, so names with dots in a
 * directory segment or before the extension (e.g. "2024.01/photo",
 * "my.photo.jpg") keep their real path/basename instead of being truncated.
 */
export function swapToWebpExtension(name: string): string {
  return name.replace(/\.[A-Za-z0-9]+$/, "") + ".webp";
}

export async function compressImage(file: File): Promise<File> {
  if (!COMPRESSIBLE.has(file.type)) return file;
  if (
    typeof document === "undefined" ||
    typeof createImageBitmap === "undefined"
  ) {
    return file;
  }

  try {
    // imageOrientation:"from-image" bakes in EXIF rotation so portrait phone
    // photos don't come out sideways once the orientation metadata is dropped.
    const bitmap = await createImageBitmap(file, {
      imageOrientation: "from-image",
    });

    const { width, height } = bitmap;
    const scale = Math.min(1, MAX_EDGE / Math.max(width, height));
    const targetW = Math.max(1, Math.round(width * scale));
    const targetH = Math.max(1, Math.round(height * scale));

    const canvas = document.createElement("canvas");
    canvas.width = targetW;
    canvas.height = targetH;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      bitmap.close();
      return file;
    }
    ctx.drawImage(bitmap, 0, 0, targetW, targetH);
    bitmap.close();

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/webp", QUALITY)
    );

    // Bail if encoding failed or the "optimized" file is no smaller (e.g. an
    // already-tiny WebP) — never make an upload bigger.
    if (!blob || blob.size >= file.size) return file;

    const newName = swapToWebpExtension(file.name);
    return new File([blob], newName, {
      type: "image/webp",
      lastModified: file.lastModified,
    });
  } catch {
    return file;
  }
}
