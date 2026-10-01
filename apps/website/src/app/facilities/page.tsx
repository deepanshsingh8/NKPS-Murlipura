import { Metadata } from "next";
import { FacilitiesContent } from "./FacilitiesContent";
import { JsonLd } from "@/components/seo/JsonLd";
import { getPageMedia, mediaUrl, getSectionCards } from "@/lib/site-media";
import { buildMetadata, breadcrumbJsonLd } from "@nkps/shared/lib/seo";

export const metadata: Metadata = buildMetadata({
  title: "Campus Facilities & Labs",
  description:
    "Smart classrooms, science and computer labs, a 10,000-volume library, sports grounds, auditorium and bus transport at NK Public School, Murlipura.",
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
