import type { Metadata } from "next";
import { Inter, Playfair_Display, Caveat } from "next/font/google";
import { GoogleAnalytics } from "@next/third-parties/google";
import { Analytics } from "@vercel/analytics/next";
import { Toaster } from "@nkps/shared/components/ui/sonner";
import { LayoutShell } from "@/components/layout/LayoutShell";
import { JsonLd } from "@/components/seo/JsonLd";
import { SITE_URL, schoolJsonLd } from "@nkps/shared/lib/seo";
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  display: "swap",
});

const playfair = Playfair_Display({
  variable: "--font-playfair",
  subsets: ["latin"],
  display: "swap",
});

// Chalk / handwriting display face for the blackboard theme.
const caveat = Caveat({
  variable: "--font-chalk-hand",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
});

const GA_ID = process.env.NEXT_PUBLIC_GA_ID;
const GSC_VERIFICATION = process.env.NEXT_PUBLIC_GSC_VERIFICATION;

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: "NK Public School, Murlipura — Established 1985",
    template: "%s | NK Public School, Murlipura",
  },
  description:
    "NK Public School, Murlipura — the founding NKPS campus in Arya Nagar, Jaipur. English medium, co-educational, Nursery to Class XII with Science and Commerce streams.",
  keywords: [
    "NK Public School Murlipura",
    "NKPS Murlipura",
    "Best School in Murlipura Jaipur",
    "School in Arya Nagar Jaipur",
    "CBSE School Murlipura",
    "Schools near Murlipura",
    "Top School North Jaipur",
    "School Admissions Jaipur",
    "Co-ed School Jaipur",
    "English Medium School Murlipura",
  ],
  authors: [{ name: "NK Public School, Murlipura" }],
  creator: "NK Public School, Murlipura",
  publisher: "NK Public School, Murlipura",
  alternates: { canonical: "/" },
  openGraph: {
    title: "NK Public School, Murlipura — Established 1985",
    description:
      "The founding NKPS campus in Arya Nagar, Murlipura, Jaipur — co-educational, English medium, Nursery to Class XII (Science & Commerce).",
    url: SITE_URL,
    type: "website",
    locale: "en_IN",
    siteName: "NK Public School, Murlipura",
    images: [
      {
        url: `${SITE_URL}/opengraph-image`,
        width: 1200,
        height: 630,
        alt: "NK Public School, Murlipura — Jaipur",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "NK Public School, Murlipura — Established 1985",
    description:
      "The founding NKPS campus in Murlipura, Jaipur — Nursery to Class XII with Science and Commerce streams.",
    images: [`${SITE_URL}/opengraph-image`],
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-image-preview": "large",
      "max-snippet": -1,
      "max-video-preview": -1,
    },
  },
  verification: GSC_VERIFICATION ? { google: GSC_VERIFICATION } : undefined,
  category: "education",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${inter.variable} ${playfair.variable} ${gaegu.variable}`}>
      <body className="min-h-screen flex flex-col antialiased">
        <JsonLd data={schoolJsonLd} />
        <LayoutShell>
          <main className="flex-1">{children}</main>
        </LayoutShell>
        <Toaster position="top-right" richColors />
        {GA_ID ? <GoogleAnalytics gaId={GA_ID} /> : null}
        <Analytics />
      </body>
    </html>
  );
}
