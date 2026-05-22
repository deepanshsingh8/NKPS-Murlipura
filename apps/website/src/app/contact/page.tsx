import type { Metadata } from "next";
import { ContactPageClient } from "./ContactPageClient";
import { CONTACT_FAQS } from "./faqs";
import { JsonLd } from "@/components/seo/JsonLd";
import { buildMetadata, breadcrumbJsonLd, faqJsonLd } from "@nkps/shared/lib/seo";
import { SCHOOL } from "@nkps/shared/lib/constants";

export const metadata: Metadata = buildMetadata({
  title: "Contact NK Public School, Murlipura — Arya Nagar, Jaipur",
  description: `Contact NK Public School, Murlipura, Jaipur. Call ${SCHOOL.phone[0]} or ${SCHOOL.phone[1]}, email ${SCHOOL.email[0]}, or visit us at ${SCHOOL.address.full}. Office hours ${SCHOOL.officeHours}.`,
  path: "/contact",
});

export default function ContactPage() {
  return (
    <>
      <JsonLd
        data={breadcrumbJsonLd([
          { name: "Home", path: "/" },
          { name: "Contact", path: "/contact" },
        ])}
      />
      <JsonLd
        data={faqJsonLd(
          CONTACT_FAQS.map((f) => ({ q: f.question, a: f.answer }))
        )}
      />
      <ContactPageClient />
    </>
  );
}
