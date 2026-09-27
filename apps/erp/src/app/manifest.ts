import { buildManifest } from "@nkps/shared/lib/pwa-manifest";
import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return buildManifest({
    name: "NKPS Portal",
    shortName: "NKPS Portal",
    description:
      "NK Public School portal — attendance, results, fees, and timetable for staff, teachers, students, and parents.",
    // No shortcuts on purpose. This one app serves five roles and every screen
    // worth linking to lives at a different path for each of them (attendance
    // is /attendance, /teacher/attendance, /student/attendance and
    // /parent/attendance). A manifest shortcut is static and shown to whoever
    // installed the app, so any one of those choices sends four roles out
    // through a redirect. `start_url: "/"` already role-routes via the auth
    // gate, which is the behaviour that actually generalises.
  });
}
