import type { Metadata } from "next";
import { SCHOOL } from "@nkps/shared/lib/constants";

const DEFAULT_SITE_URL = "https://www.nkpsmurlipura.com";

function normalizeSiteUrl(raw: string | undefined): string {
  if (!raw || !raw.trim()) return DEFAULT_SITE_URL;
  const trimmed = raw.trim();
  const withProtocol =
    trimmed.startsWith("http://") || trimmed.startsWith("https://")
      ? trimmed
      : `https://${trimmed}`;
  return withProtocol.replace(/\/+$/, "");
}

export const SITE_URL = normalizeSiteUrl(process.env.NEXT_PUBLIC_SITE_URL);

const DEFAULT_OG_IMAGE = `${SITE_URL}/opengraph-image`;

type BuildMetadataArgs = {
  title: string;
  description: string;
  path: string;
  image?: string;
  noIndex?: boolean;
};

export function buildMetadata({
  title,
  description,
  path,
  image,
  noIndex,
}: BuildMetadataArgs): Metadata {
  const url = `${SITE_URL}${path.startsWith("/") ? path : `/${path}`}`;
  const ogImage = image || DEFAULT_OG_IMAGE;

  return {
    title,
    description,
    alternates: { canonical: url },
    openGraph: {
      title,
      description,
      url,
      type: "website",
      locale: "en_IN",
      siteName: SCHOOL.name,
      images: [{ url: ogImage, width: 1200, height: 630, alt: title }],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [ogImage],
    },
    robots: noIndex
      ? { index: false, follow: false }
      : { index: true, follow: true },
  };
}

const SCHOOL_ID = `${SITE_URL}/#school`;
const ORG_ID = `${SITE_URL}/#organization`;
const PLACE_ID = `${SITE_URL}/#place`;

export const schoolJsonLd = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": ["EducationalOrganization", "School"],
      "@id": SCHOOL_ID,
      name: SCHOOL.name,
      alternateName: SCHOOL.shortName,
      description: SCHOOL.description,
      url: SITE_URL,
      logo: `${SITE_URL}/images/logo.png`,
      image: `${SITE_URL}/opengraph-image`,
      foundingDate: String(SCHOOL.founded),
      slogan: SCHOOL.tagline,
      telephone: SCHOOL.phone[0],
      faxNumber: SCHOOL.fax,
      email: SCHOOL.email[0],
      sameAs: [
        SCHOOL.social.facebook,
        SCHOOL.social.instagram,
        SCHOOL.social.youtube,
      ].filter(Boolean),
      address: {
        "@type": "PostalAddress",
        streetAddress: SCHOOL.address.line1,
        addressLocality: SCHOOL.address.city,
        addressRegion: SCHOOL.address.state,
        postalCode: SCHOOL.address.pin,
        addressCountry: "IN",
      },
      location: { "@id": PLACE_ID },
      areaServed: [
        { "@type": "City", name: "Jaipur" },
        { "@type": "State", name: "Rajasthan" },
        { "@type": "Country", name: "India" },
      ],
      accreditedBy: {
        "@type": "EducationalOrganization",
        name: "Central Board of Secondary Education",
        alternateName: "CBSE",
        url: "https://www.cbse.gov.in",
        // Only assert an affiliation number once it is confirmed for the
        // Murlipura campus — never emit an empty or a sister-branch number.
        ...(SCHOOL.affiliationNumber
          ? { identifier: SCHOOL.affiliationNumber }
          : {}),
      },
      ...(SCHOOL.affiliationNumber
        ? {
            identifier: {
              "@type": "PropertyValue",
              propertyID: "CBSE Affiliation Number",
              value: SCHOOL.affiliationNumber,
            },
          }
        : {}),
      employee: SCHOOL.leadership.map((l) => ({
        "@type": "Person",
        name: l.name,
        jobTitle: l.designation,
      })),
      founder: {
        "@type": "Person",
        name: SCHOOL.founder.name,
        description: SCHOOL.founder.bio,
      },
    },
    {
      "@type": "LocalBusiness",
      "@id": ORG_ID,
      name: SCHOOL.name,
      image: `${SITE_URL}/opengraph-image`,
      url: SITE_URL,
      telephone: SCHOOL.phone[0],
      email: SCHOOL.email[0],
      priceRange: SCHOOL.priceRange,
      address: {
        "@type": "PostalAddress",
        streetAddress: SCHOOL.address.line1,
        addressLocality: SCHOOL.address.city,
        addressRegion: SCHOOL.address.state,
        postalCode: SCHOOL.address.pin,
        addressCountry: "IN",
      },
      geo: {
        "@type": "GeoCoordinates",
        latitude: SCHOOL.geo.lat,
        longitude: SCHOOL.geo.lng,
      },
      openingHoursSpecification: [
        {
          "@type": "OpeningHoursSpecification",
          dayOfWeek: [
            "Monday",
            "Tuesday",
            "Wednesday",
            "Thursday",
            "Friday",
            "Saturday",
          ],
          opens: "09:00",
          closes: "15:00",
        },
      ],
      sameAs: [
        SCHOOL.social.facebook,
        SCHOOL.social.instagram,
        SCHOOL.social.youtube,
      ].filter(Boolean),
    },
    {
      "@type": "Place",
      "@id": PLACE_ID,
      name: SCHOOL.name,
      address: {
        "@type": "PostalAddress",
        streetAddress: SCHOOL.address.line1,
        addressLocality: SCHOOL.address.city,
        addressRegion: SCHOOL.address.state,
        postalCode: SCHOOL.address.pin,
        addressCountry: "IN",
      },
      geo: {
        "@type": "GeoCoordinates",
        latitude: SCHOOL.geo.lat,
        longitude: SCHOOL.geo.lng,
      },
    },
  ],
};

export type BreadcrumbItem = { name: string; path: string };

export function breadcrumbJsonLd(items: BreadcrumbItem[]) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: item.name,
      item: `${SITE_URL}${item.path.startsWith("/") ? item.path : `/${item.path}`}`,
    })),
  };
}

export type FaqItem = { q: string; a: string };

export function faqJsonLd(items: FaqItem[]) {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: items.map((item) => ({
      "@type": "Question",
      name: item.q,
      acceptedAnswer: {
        "@type": "Answer",
        text: item.a,
      },
    })),
  };
}
