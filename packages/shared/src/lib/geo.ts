// Canonical school location + great-circle (straight-line) distance.
//
// These are PURE functions with no browser or Google dependencies, so they are
// safe to import from server routes (e.g. /api/students/transport) as well as
// client components. The school coordinate used to be copy-pasted into four
// places (the map, the transport API route, two fee components); this is now
// the single source of truth.
export const SCHOOL = { lat: 27.0688458, lng: 75.7495752 } as const;

// Great-circle distance in km between two lat/lng points. This is the
// straight-line ("as the crow flies") distance — used now only as an audit
// FLOOR for the real road distance (road distance is always >= straight line)
// and as a clearly-labelled estimate in the UI, never as the billed number.
export function haversineKm(
  aLat: number,
  aLng: number,
  bLat: number,
  bLng: number
): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const lat1 = toRad(aLat);
  const lat2 = toRad(bLat);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.sin(dLng / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
  return 2 * R * Math.asin(Math.sqrt(a));
}
