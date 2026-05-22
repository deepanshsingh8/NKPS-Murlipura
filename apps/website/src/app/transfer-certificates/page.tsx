import type { Metadata } from "next";
import { TransferCertificatesPageClient } from "./TransferCertificatesPageClient";
import { JsonLd } from "@/components/seo/JsonLd";
import { buildMetadata, breadcrumbJsonLd } from "@nkps/shared/lib/seo";

export const metadata: Metadata = buildMetadata({
  title: "Transfer Certificates — NK Public School, Murlipura",
  description:
    "Search and download transfer certificates (TC) issued by NK Public School, Murlipura, Jaipur. If you can't find a certificate, contact the school office.",
  path: "/transfer-certificates",
});

export default function TransferCertificatesPage() {
  return (
    <>
      <JsonLd
        data={breadcrumbJsonLd([
          { name: "Home", path: "/" },
          { name: "Transfer Certificates", path: "/transfer-certificates" },
        ])}
      />
      <TransferCertificatesPageClient />
    </>
  );
}
