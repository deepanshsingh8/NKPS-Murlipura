import type { MetadataRoute } from "next";

// Shared web-app-manifest builder for the ERP and CMS installable apps. Both
// apps expose this via their own app/manifest.ts (Next file convention) so the
// display/theme/icon definition lives in exactly one place and can't drift.
//
// theme_color matches --color-navy-900 (globals.css); background_color is the
// splash-screen colour shown before first paint, kept white so the splash
// doesn't flash dark before a light UI loads.
const THEME_COLOR = "#0A3D2A";
const BACKGROUND_COLOR = "#FFFFFF";

interface ManifestOptions {
  name: string;
  shortName: string;
  description: string;
  /** Where the app opens from the home-screen icon. "/" lets the auth
   *  middleware redirect each role to its own dashboard. */
  startUrl?: string;
}

export function buildManifest({
  name,
  shortName,
  description,
  startUrl = "/",
}: ManifestOptions): MetadataRoute.Manifest {
  return {
    name,
    short_name: shortName,
    description,
    start_url: startUrl,
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: BACKGROUND_COLOR,
    theme_color: THEME_COLOR,
    icons: [
      {
        src: "/icons/icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
