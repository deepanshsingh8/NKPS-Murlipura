-- Migration 079 — allow WebP in the staff-photos storage bucket.
--
-- The browser upload pipeline (packages/shared/src/lib/image-compress.ts, run
-- from uploadToStorage) downscales and re-encodes raster images to WebP before
-- upload. The staff-photos bucket's MIME allowlist (set in migration 061) only
-- permitted image/jpeg and image/png, so every cropped staff photo — which
-- arrives as image/webp — was rejected at the storage layer with
-- "mime type image/webp is not supported".
--
-- Bring staff-photos in line with the other public image buckets
-- (gallery / site-media / avatars already allow webp). Size cap unchanged.
-- Idempotent: re-running just re-sets the same array.

UPDATE storage.buckets
  SET allowed_mime_types = ARRAY['image/jpeg','image/png','image/webp']
  WHERE id = 'staff-photos';
