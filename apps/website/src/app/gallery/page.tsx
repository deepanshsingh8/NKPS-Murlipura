import type { Metadata } from "next";
import { GalleryPageClient } from "./GalleryPageClient";
import { JsonLd } from "@/components/seo/JsonLd";
import { buildMetadata, breadcrumbJsonLd } from "@nkps/shared/lib/seo";
import { getPublicGallery } from "@/lib/gallery";

export const metadata: Metadata = buildMetadata({
  title: "Photo Gallery",
  description:
    "Campus life at NK Public School, Murlipura — annual events, sports meets, cultural programmes and everyday moments from our Arya Nagar campus, Jaipur.",
  path: "/gallery",
});

export const revalidate = 60;

export default async function GalleryPage() {
  const { images, events } = await getPublicGallery();

  return (
    <>
      <JsonLd
        data={breadcrumbJsonLd([
          { name: "Home", path: "/" },
          { name: "Gallery", path: "/gallery" },
        ])}
      />
      <GalleryPageClient galleryImages={images} galleryEvents={events} />
    </>
  );
}
