import { buildManifest } from "@nkps/shared/lib/pwa-manifest";
import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return buildManifest({
    name: "NKPS CMS",
    shortName: "NKPS CMS",
    description:
      "NK Public School content management — gallery, news, and site content administration.",
    // The CMS has one audience (admins and editors), so a deep link means the
    // same thing to everyone who installed it. Editors without a given grant
    // are redirected by the auth gate rather than shown a broken page.
    shortcuts: [
      { name: "Contact Messages", shortName: "Messages", url: "/contact" },
      { name: "Gallery", url: "/gallery" },
      { name: "Articles", url: "/articles" },
    ],
  });
}
