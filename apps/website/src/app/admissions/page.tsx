import type { Metadata } from "next";
import { AdmissionsPageClient } from "./AdmissionsPageClient";
import { ADMISSIONS_FAQS } from "./faqs";
import { JsonLd } from "@/components/seo/JsonLd";
import { buildMetadata, breadcrumbJsonLd, faqJsonLd } from "@nkps/shared/lib/seo";

export const metadata: Metadata = buildMetadata({
  title: "Admissions — Apply to NK Public School, Murlipura (Nursery–XII)",
  description:
    "Admission process, eligibility, fees and FAQ for NK Public School, Murlipura, Jaipur — English medium co-ed school (Nursery to Class XII). Call the school office to begin your admission today.",
  path: "/admissions",
});

export default function AdmissionsPage() {
  return (
    <>
      <JsonLd
        data={breadcrumbJsonLd([
          { name: "Home", path: "/" },
          { name: "Admissions", path: "/admissions" },
        ])}
      />
      <JsonLd data={faqJsonLd(ADMISSIONS_FAQS)} />
      <AdmissionsPageClient />
    </>
  );
}
