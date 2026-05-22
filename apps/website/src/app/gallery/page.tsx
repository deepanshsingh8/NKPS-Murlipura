import type { Metadata } from "next";
import { GalleryPageClient } from "./GalleryPageClient";
import { JsonLd } from "@/components/seo/JsonLd";
import { buildMetadata, breadcrumbJsonLd } from "@nkps/shared/lib/seo";

export const metadata: Metadata = buildMetadata({
  title: "Photo Gallery — Life at NK Public School, Murlipura",
  description:
    "Glimpses of campus life at NK Public School, Murlipura — annual events, sports meets, cultural programs, academics and everyday moments from our Arya Nagar campus.",
  path: "/gallery",
});

export default function GalleryPage() {
  return (
    <>
      <JsonLd
        data={breadcrumbJsonLd([
          { name: "Home", path: "/" },
          { name: "Gallery", path: "/gallery" },
        ])}
      />
      <GalleryPageClient />
    </>
  );
}
