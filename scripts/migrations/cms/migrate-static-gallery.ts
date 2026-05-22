/**
 * One-time migration: upload the 12 static gallery images to Supabase storage
 * and insert them into the gallery_images table so they appear in the admin panel.
 *
 * Usage: npx tsx scripts/migrations/cms/migrate-static-gallery.ts
 *
 * Requires NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local
 */

import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import { resolve, join } from "path";
import { readFileSync } from "fs";

config({ path: resolve(__dirname, "../../../.env.local") });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!supabaseUrl || !serviceRoleKey) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceRoleKey);

const STATIC_IMAGES = [
  { category: "campus", alt: "School Campus", path: "images/gallery/g10.jpg" },
  { category: "events", alt: "School Event", path: "images/news/n1.jpg" },
  { category: "sports", alt: "Sports Activities", path: "images/news/n3.jpg" },
  { category: "cultural", alt: "Cultural Programme", path: "images/news/n5.jpg" },
  { category: "events", alt: "Annual Function", path: "images/news/n2.jpg" },
  { category: "academics", alt: "Academic Excellence", path: "images/news/n4.jpg" },
  { category: "cultural", alt: "Performance", path: "images/news/n6.jpg" },
  { category: "campus", alt: "School Life", path: "images/news/n7.jpg" },
  { category: "academics", alt: "Student Achievement", path: "images/gallery/st1.jpg" },
  { category: "academics", alt: "Shining Star", path: "images/gallery/st2.jpg" },
  { category: "academics", alt: "Student Success", path: "images/gallery/st3.jpg" },
  { category: "events", alt: "School Assembly", path: "images/gallery/st4.jpg" },
];

async function main() {
  // Check for duplicates
  const { count } = await supabase
    .from("gallery_images")
    .select("id", { count: "exact", head: true })
    .in("alt", STATIC_IMAGES.map((i) => i.alt));

  if (count && count > 0) {
    console.log(`⚠️  Found ${count} existing images with matching alt text. Skipping to avoid duplicates.`);
    console.log("   Delete them from the admin panel first if you want to re-run this migration.");
    process.exit(0);
  }

  const publicDir = join(__dirname, "..", "public");
  let succeeded = 0;

  for (let i = 0; i < STATIC_IMAGES.length; i++) {
    const img = STATIC_IMAGES[i];
    const filePath = join(publicDir, img.path);

    try {
      const buffer = readFileSync(filePath);
      const ext = img.path.split(".").pop();
      const fileName = `migrated-${Date.now()}-${i}.${ext}`;

      const { error: uploadError } = await supabase.storage
        .from("gallery")
        .upload(fileName, buffer, {
          contentType: `image/${ext === "jpg" ? "jpeg" : ext}`,
        });

      if (uploadError) {
        console.error(`❌ Upload failed for ${img.path}: ${uploadError.message}`);
        continue;
      }

      const {
        data: { publicUrl },
      } = supabase.storage.from("gallery").getPublicUrl(fileName);

      const { error: insertError } = await supabase
        .from("gallery_images")
        .insert({
          src: publicUrl,
          alt: img.alt,
          category: img.category,
          sort_order: i,
        });

      if (insertError) {
        console.error(`❌ DB insert failed for ${img.path}: ${insertError.message}`);
        continue;
      }

      console.log(`✅ ${img.alt} (${img.path})`);
      succeeded++;
    } catch (err) {
      console.error(`❌ Error processing ${img.path}:`, err);
    }
  }

  console.log(`\nDone: ${succeeded}/${STATIC_IMAGES.length} images migrated.`);
}

main();
