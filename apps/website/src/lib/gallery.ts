import { createAdminClient } from "@nkps/shared/lib/supabase/admin";

export type GalleryImage = { id: string; category: string; alt: string; src: string };

export interface GalleryEventWithImages {
  id: string;
  title: string;
  event_date: string;
  academic_year: string | null;
  image_count: number;
  cover_url: string | null;
}

/**
 * Public gallery data for /gallery: standalone images plus public events with
 * their photo count and cover. The admin client bypasses RLS, so the anon
 * SELECT policies (standalone images; events with is_public) are mirrored in
 * the filters below. Event image rows are only used here to derive counts and
 * covers for public events; they are not returned.
 */
export async function getPublicGallery(): Promise<{
  images: GalleryImage[];
  events: GalleryEventWithImages[];
}> {
  const supabase = createAdminClient();

  const [{ data: imgs }, { data: events }] = await Promise.all([
    supabase
      .from("gallery_images")
      .select("id, src, alt, category")
      .is("gallery_event_id", null)
      .order("sort_order", { ascending: true }),
    supabase
      .from("gallery_events")
      .select("id, title, event_date, academic_year, cover_image_url")
      .eq("is_public", true)
      .order("event_date", { ascending: false }),
  ]);

  const images: GalleryImage[] = (imgs ?? []).map((img) => ({
    id: String(img.id),
    src: img.src,
    alt: img.alt,
    category: img.category,
  }));

  if (!events || events.length === 0) return { images, events: [] };

  // Get image counts AND first image per event for cover fallback
  const { data: eventImgs } = await supabase
    .from("gallery_images")
    .select("gallery_event_id, src")
    .not("gallery_event_id", "is", null)
    .order("sort_order", { ascending: true });

  const counts: Record<string, number> = {};
  const firstImages: Record<string, string> = {};
  (eventImgs ?? []).forEach((img: { gallery_event_id: string | null; src: string }) => {
    if (img.gallery_event_id) {
      counts[img.gallery_event_id] = (counts[img.gallery_event_id] || 0) + 1;
      if (!firstImages[img.gallery_event_id]) {
        firstImages[img.gallery_event_id] = img.src;
      }
    }
  });

  return {
    images,
    events: events.map((e) => ({
      id: e.id,
      title: e.title,
      event_date: e.event_date,
      academic_year: e.academic_year,
      image_count: counts[e.id] || 0,
      cover_url: e.cover_image_url || firstImages[e.id] || null,
    })),
  };
}
