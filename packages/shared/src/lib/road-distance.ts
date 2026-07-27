/// <reference types="google.maps" />

// Browser-only helper that computes the REAL road (driving) distance between
// two points using the Google Maps JavaScript SDK's DirectionsService.
//
// Why client-side and not a server route:
//   The only Google key we have (NEXT_PUBLIC_GOOGLE_MAPS_API_KEY) is
//   referrer-restricted for browser use. A server-to-server Routes API call
//   with it would be rejected, so the distance is computed in the browser
//   (where the referrer matches) and then submitted to the server, which
//   re-validates it against a straight-line floor before billing. If a
//   dedicated server key is added later, an authoritative server recompute
//   can replace this — the persistence schema already supports it.
//
// DirectionsService is a standalone *service*: it returns route data without
// needing a rendered Google map, so the result (distance + path) is drawn on
// the existing Leaflet map by the callers.

import { setOptions, importLibrary } from "@googlemaps/js-api-loader";

export interface RoadDistanceResult {
  km: number;
  // Decoded route geometry as plain coords, ready to feed a Leaflet polyline.
  path: { lat: number; lng: number }[];
  // Encoded overview polyline — persisted so the route can be redrawn / audited
  // later without another billable Directions call.
  encodedPolyline: string | null;
}

// Thrown for every non-success outcome (no key, ZERO_RESULTS, quota, network).
// Callers use this to hit the "block auto-slab, require manual choice" path —
// we never silently fall back to a straight-line guess for billing.
export class RoadDistanceError extends Error {
  constructor(public reason: string) {
    super(`Road distance unavailable: ${reason}`);
    this.name = "RoadDistanceError";
  }
}

// Mirror of the gate in PlacesAutocompleteInput — same loader, same key.
let optionsApplied = false;
function ensureLoaderOptions(apiKey: string) {
  if (optionsApplied) return;
  setOptions({ key: apiKey, v: "weekly" });
  optionsApplied = true;
}

export function isRoadDistanceConfigured(): boolean {
  return Boolean(
    typeof process !== "undefined" &&
      process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY
  );
}

export async function roadDistanceKm(
  origin: { lat: number; lng: number },
  dest: { lat: number; lng: number }
): Promise<RoadDistanceResult> {
  const apiKey =
    typeof process !== "undefined"
      ? process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY
      : undefined;
  if (!apiKey) throw new RoadDistanceError("NO_API_KEY");
  ensureLoaderOptions(apiKey);

  const routesLib = (await importLibrary(
    "routes"
  )) as google.maps.RoutesLibrary;
  const service = new routesLib.DirectionsService();

  let result: google.maps.DirectionsResult;
  try {
    result = await service.route({
      origin,
      destination: dest,
      // String form avoids depending on the runtime enum object being loaded;
      // google.maps.TravelMode.DRIVING === "DRIVING".
      travelMode: "DRIVING" as google.maps.TravelMode,
      provideRouteAlternatives: false,
      // No drivingOptions/departureTime → deterministic, traffic-independent
      // distance so the same address always slabs the same way.
    });
  } catch (e) {
    const reason =
      (e as { code?: string })?.code ?? (e as Error)?.message ?? "ROUTE_FAILED";
    throw new RoadDistanceError(String(reason));
  }

  const route = result.routes?.[0];
  const leg = route?.legs?.[0];
  const meters = leg?.distance?.value;
  if (route == null || leg == null || meters == null) {
    throw new RoadDistanceError("ZERO_RESULTS");
  }

  const path = (route.overview_path ?? []).map((p) => ({
    lat: p.lat(),
    lng: p.lng(),
  }));
  const encodedPolyline =
    (route as unknown as { overview_polyline?: string }).overview_polyline ??
    null;

  return { km: meters / 1000, path, encodedPolyline };
}
