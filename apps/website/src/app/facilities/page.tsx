import { Metadata } from "next";
import { FacilitiesContent } from "./FacilitiesContent";
import { JsonLd } from "@/components/seo/JsonLd";
import { getPageMedia, mediaUrl, getSectionCards } from "@/lib/site-media";
import { buildMetadata, breadcrumbJsonLd } from "@nkps/shared/lib/seo";

export const metadata: Metadata = buildMetadata({
  title: "Facilities — Smart Classrooms, Labs, Library — NKPS Jaipur",
  description:
    "Modern facilities at NK Public School, Jaipur — smart classrooms, science and computer labs, 10,000-volume library, sports grounds, auditorium, indoor games and school bus transport.",
  path: "/facilities",
});

export const revalidate = 60;

export default async function FacilitiesPage() {
  const [facilitiesMedia, campusFacilityCards] = await Promise.all([
    getPageMedia("facilities"),
    getSectionCards("campus_facilities"),
  ]);

  const heroImage = mediaUrl(facilitiesMedia, "facilities_hero", "/images/hero/campus-1.jpg");

  return (
    <>
      <JsonLd
        data={breadcrumbJsonLd([
          { name: "Home", path: "/" },
          { name: "Facilities", path: "/facilities" },
        ])}
      />
      <FacilitiesContent heroImage={heroImage} cards={campusFacilityCards} />
    </>
  );
}
