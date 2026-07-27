import { buildManifest } from "@nkps/shared/lib/pwa-manifest";
import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return buildManifest({
    name: "NKPS CMS",
    shortName: "NKPS CMS",
    description:
      "NK Public School content management — gallery, news, and site content administration.",
  });
}
