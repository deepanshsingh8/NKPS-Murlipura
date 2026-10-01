import type { Metadata } from "next";
import { AlumniPageClient } from "./AlumniPageClient";
import { getSectionCards } from "@/lib/site-media";
import { JsonLd } from "@/components/seo/JsonLd";
import { buildMetadata, breadcrumbJsonLd } from "@nkps/shared/lib/seo";

export const metadata: Metadata = buildMetadata({
  title: "Alumni Network & Achievements",
  description:
    "Meet NK Public School, Murlipura alumni and their achievements in medicine, engineering, civil services, business and more. Join our alumni network.",
  path: "/alumni",
});

// ISR: revalidate every 60s, plus on-demand via revalidatePath from admin
export const revalidate = 60;

export default async function AlumniPage() {
  const alumniCards = await getSectionCards("alumni");

  return (
    <>
      <JsonLd
        data={breadcrumbJsonLd([
          { name: "Home", path: "/" },
          { name: "Alumni", path: "/alumni" },
        ])}
      />
      <AlumniPageClient cards={alumniCards} />
    </>
  );
}
