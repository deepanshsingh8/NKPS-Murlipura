import type { Metadata, Viewport } from "next";
import { Inter, Playfair_Display } from "next/font/google";
import { Toaster } from "@nkps/shared/components/ui/sonner";
import { PWARegister } from "@nkps/shared/components/pwa/PWARegister";
import { InstallPrompt } from "@nkps/shared/components/pwa/InstallPrompt";
import { CmsShell } from "@/components/CmsShell";
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

export const metadata: Metadata = {
  title: "NKPS CMS",
  robots: { index: false, follow: false },
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "NKPS CMS",
  },
};

export const viewport: Viewport = {
  themeColor: "#0A3D2A",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${inter.variable} ${playfair.variable}`}>
      <body className="min-h-screen antialiased">
        <CmsShell>{children}</CmsShell>
        <PWARegister />
        <InstallPrompt appName="NKPS CMS" />
        <Toaster position="top-right" richColors />
      </body>
    </html>
  );
}
