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

/**
 * Bump whenever `scripts/generate-pwa-icons.mjs` regenerates the PNGs.
 *
 * The icons keep their filenames, so a regeneration leaves the URLs
 * byte-different but string-identical — and nothing downstream can tell that
 * anything changed. Android's WebAPK updater refetches the manifest, compares
 * it with the one it installed, sees the same three `src` values and keeps the
 * old launcher icon; the CDN and the browser cache have no reason to
 * revalidate either. That is how the icon change in 31cb00e shipped and then
 * did not arrive on anyone's phone.
 *
 * What this does NOT do is change an icon already sitting on a home screen.
 * iOS fetches that once, at Add-to-Home-Screen time, and never looks again —
 * that one needs a remove and a re-add, and no amount of deploying helps. This
 * is about every install and every update check after the change.
 *
 * It also names the service-worker shell cache, deliberately: one number, so
 * one bump both re-versions the icon URLs and drops the stale cache that still
 * holds the previous PNGs. `scripts/check-pwa-icons.mjs` keeps the two sw.js
 * files in step with it, since a static file in public/ cannot import this.
 */
export const ICON_VERSION = "3";

/** An icon URL carrying the current version. */
export function iconUrl(file: string): string {
  return `/icons/${file}?v=${ICON_VERSION}`;
}

/** A long-press target on the home-screen icon. */
export interface ManifestShortcut {
  name: string;
  shortName?: string;
  description?: string;
  /** App-relative, e.g. "/attendance". */
  url: string;
}

interface ManifestOptions {
  name: string;
  shortName: string;
  description: string;
  /** Where the app opens from the home-screen icon. "/" lets the auth
   *  middleware redirect each role to its own dashboard. */
  startUrl?: string;
  /** Up to ~4 are surfaced by Android; iOS ignores them entirely. */
  shortcuts?: ManifestShortcut[];
}

export function buildManifest({
  name,
  shortName,
  description,
  startUrl = "/",
  shortcuts = [],
}: ManifestOptions): MetadataRoute.Manifest {
  return {
    // A stable identity for the install, independent of start_url. Without it
    // the browser keys the installed app on start_url, and changing that later
    // registers a second app rather than updating the first.
    id: "/",
    name,
    short_name: shortName,
    description,
    start_url: startUrl,
    scope: "/",
    display: "standalone",
    // Preference order, not a single answer: a browser that can't honour
    // standalone falls back to minimal-ui (which keeps a slim URL bar) rather
    // than all the way to a full browser tab.
    display_override: ["standalone", "minimal-ui"],
    // Was "portrait", which locked the app upright even on a tablet. The
    // screens that most need width — the wide admin tables — were the ones it
    // stopped anyone from turning sideways to read.
    orientation: "any",
    categories: ["education", "productivity"],
    shortcuts: shortcuts.map((s) => ({
      name: s.name,
      short_name: s.shortName ?? s.name,
      description: s.description,
      url: s.url,
      icons: [
        { src: iconUrl("icon-192.png"), sizes: "192x192", type: "image/png" },
      ],
    })),
    background_color: BACKGROUND_COLOR,
    theme_color: THEME_COLOR,
    icons: [
      {
        src: iconUrl("icon-192.png"),
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: iconUrl("icon-512.png"),
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: iconUrl("icon-maskable-512.png"),
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
