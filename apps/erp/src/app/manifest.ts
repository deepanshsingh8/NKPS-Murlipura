import { buildManifest } from "@nkps/shared/lib/pwa-manifest";
import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return buildManifest({
    name: "NKPS Portal",
    shortName: "NKPS Portal",
    description:
      "NK Public School portal — attendance, results, fees, and timetable for staff, teachers, students, and parents.",
  });
}
