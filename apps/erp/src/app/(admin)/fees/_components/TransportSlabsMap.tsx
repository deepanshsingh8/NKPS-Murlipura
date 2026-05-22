"use client";

import { useEffect, useRef, useState } from "react";
import type { Map as LeafletMap, Circle, Marker, LayerGroup } from "leaflet";
import type { TransportFareSlab } from "@nkps/shared/types";

// Plain Leaflet (no react-leaflet) keeps the dep surface small. The map is
// instantiated lazily on mount; re-renders only redraw the slab layers, the
// tile layer and marker are reused.

const SCHOOL = { lat: 27.0688458, lng: 75.7495752 };

// Concentric rings are easier to read when the inner band is bright/warm
// and rings step outward through cooler tones. Keep these pastels — admin
// reads through them at a glance; saturated fills make the map noisy.
const RING_PALETTE = [
  { fill: "#86efac", stroke: "#16a34a" }, // light green
  { fill: "#93c5fd", stroke: "#2563eb" }, // light blue
  { fill: "#fcd34d", stroke: "#d97706" }, // amber
  { fill: "#f9a8d4", stroke: "#db2777" }, // pink
  { fill: "#c4b5fd", stroke: "#7c3aed" }, // violet
  { fill: "#fca5a5", stroke: "#dc2626" }, // red
  { fill: "#5eead4", stroke: "#0d9488" }, // teal
] as const;

interface Props {
  slabs: TransportFareSlab[];
  // When set, this address pin is shown on the map (used by the address
  // lookup feature so admins can sanity-check the auto-picked slab).
  pickupMarker?: {
    lat: number;
    lng: number;
    label?: string;
    distanceKm?: number;
  } | null;
  // Optional click handler — receives the clicked map coordinates. When
  // provided, every click on the map (outside the school marker) fires this
  // callback. The parent typically wires this to drop a pickup pin and
  // suggest a slab without needing an address lookup.
  onMapClick?: (lat: number, lng: number) => void;
}

interface SlabRing {
  id: string;
  name: string;
  outerKm: number;
  innerKm: number | null;
  amount: number;
  frequency: string;
}

function toRings(slabs: TransportFareSlab[]): SlabRing[] {
  // Only active slabs with an outer distance are drawable. Sort by outer
  // radius ascending so the innermost band renders first (and ends up
  // visually on top when overlaps happen). Unbounded slabs go last.
  const rings = slabs
    .filter((s) => s.is_active && s.distance_km_max != null)
    .map<SlabRing>((s) => ({
      id: s.id,
      name: s.name,
      outerKm: Number(s.distance_km_max),
      innerKm: s.distance_km_min != null ? Number(s.distance_km_min) : null,
      amount: Number(s.amount),
      frequency: s.frequency,
    }))
    .sort((a, b) => a.outerKm - b.outerKm);
  return rings;
}

function formatAmount(amount: number, frequency: string) {
  const formatted = new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(amount);
  if (frequency === "one_time") return formatted;
  return `${formatted}/${frequency.replace("_", " ")}`;
}

// Stylized isometric school building. Anchor at bottom-center so the
// building base sits on the school's actual coordinates. Sized so the
// label below the building doesn't overflow the iconSize box (the previous
// "NKPS" rounded-rect pill was 40×26 but rendered wider than that, which
// is why the "S" was leaking out of the visual rectangle).
const SCHOOL_MARKER_SVG = `
<svg xmlns="http://www.w3.org/2000/svg" width="72" height="86" viewBox="0 0 72 86">
  <defs>
    <linearGradient id="bodyGrad" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#1A5F35"/>
      <stop offset="1" stop-color="#0A3D2A"/>
    </linearGradient>
    <linearGradient id="sideGrad" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#246B40"/>
      <stop offset="1" stop-color="#14532D"/>
    </linearGradient>
  </defs>
  <!-- ground shadow -->
  <ellipse cx="36" cy="78" rx="22" ry="3.5" fill="rgba(0,0,0,0.28)"/>
  <!-- right side wall (back, gives isometric depth) -->
  <polygon points="56,32 60,28 60,64 56,68" fill="url(#sideGrad)" stroke="#D4A843" stroke-width="1"/>
  <!-- main building body -->
  <polygon points="14,32 56,32 56,68 14,68" fill="url(#bodyGrad)" stroke="#D4A843" stroke-width="1.4"/>
  <!-- roof top (slanted to imply depth) -->
  <polygon points="14,32 56,32 60,28 18,28" fill="#D4A843" stroke="#B8941F" stroke-width="1"/>
  <!-- door -->
  <rect x="32" y="50" width="8" height="18" fill="#D4A843"/>
  <rect x="32" y="50" width="8" height="18" fill="none" stroke="#0A3D2A" stroke-width="0.6"/>
  <circle cx="38" cy="59" r="0.7" fill="#0A3D2A"/>
  <!-- windows -->
  <rect x="19" y="40" width="7" height="6" fill="#D4A843"/>
  <rect x="19" y="40" width="7" height="6" fill="none" stroke="#0A3D2A" stroke-width="0.4"/>
  <rect x="46" y="40" width="7" height="6" fill="#D4A843"/>
  <rect x="46" y="40" width="7" height="6" fill="none" stroke="#0A3D2A" stroke-width="0.4"/>
  <!-- flag pole + flag -->
  <line x1="35" y1="28" x2="35" y2="10" stroke="#D4A843" stroke-width="1.4" stroke-linecap="round"/>
  <polygon points="35,10 47,13 35,16" fill="#D4A843"/>
  <!-- name plate -->
  <rect x="4" y="68" width="64" height="12" rx="3" fill="#0A3D2A" stroke="#D4A843" stroke-width="1"/>
  <text x="36" y="76.5" text-anchor="middle" font-family="system-ui, -apple-system, sans-serif" font-size="8" font-weight="700" fill="#D4A843" letter-spacing="0.5">NKPS</text>
</svg>`;

export function TransportSlabsMap({ slabs, pickupMarker, onMapClick }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<LeafletMap | null>(null);
  const ringsLayerRef = useRef<LayerGroup | null>(null);
  const schoolMarkerRef = useRef<Marker | null>(null);
  const pickupMarkerRef = useRef<Marker | null>(null);
  const pickupCircleRef = useRef<Circle | null>(null);
  // Latest onMapClick — stored in a ref so the click listener attached on
  // mount always sees the current handler without us having to re-bind it.
  const onMapClickRef = useRef(onMapClick);
  useEffect(() => {
    onMapClickRef.current = onMapClick;
  }, [onMapClick]);
  // Brief overlay shown when user scroll-wheels without holding ctrl/⌘ so
  // they know how to actually zoom (matches Google Maps embed UX).
  const [scrollHintVisible, setScrollHintVisible] = useState(false);
  const scrollHintTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Mount the map exactly once. We dynamic-import leaflet so SSR doesn't
  // try to access `window` while bundling.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const L = await import("leaflet");
      // Side-effect import: Leaflet CSS lives in node_modules. Importing
      // from inside the dynamic import keeps it out of the SSR bundle and
      // away from the global CSS pipeline.
      await import("leaflet/dist/leaflet.css");
      if (cancelled || !containerRef.current || mapRef.current) return;

      const map = L.map(containerRef.current, {
        zoomControl: true,
        // Leaflet's scrollWheelZoom is all-or-nothing — it grabs every wheel
        // event, which hijacks page scroll. We disable it and re-implement
        // the ctrl/⌘+wheel pattern below so the page stays scrollable.
        scrollWheelZoom: false,
        // Prevent text selection when click-dragging across the map.
        boxZoom: true,
      }).setView([SCHOOL.lat, SCHOOL.lng], 13);

      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution:
          '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
        maxZoom: 19,
      }).addTo(map);

      // Stylized 3D-ish school marker — SVG so it scales crisply and the
      // anchor lines up exactly with the building base. iconAnchor = bottom-
      // center of the building (where the school physically sits).
      const schoolIcon = L.divIcon({
        className: "nkps-school-marker",
        html: SCHOOL_MARKER_SVG,
        iconSize: [72, 86],
        iconAnchor: [36, 80], // bottom-center, on the name-plate baseline
        popupAnchor: [0, -70],
      });
      schoolMarkerRef.current = L.marker([SCHOOL.lat, SCHOOL.lng], {
        icon: schoolIcon,
      })
        .addTo(map)
        .bindPopup("<strong>NK Public School</strong>");

      // ctrl/⌘ + wheel = zoom. Plain wheel = page scroll passes through.
      // We attach to the map's wrapper directly so we can call
      // preventDefault — Leaflet's built-in handler does the same internally.
      const container = map.getContainer();
      const handleWheel = (e: WheelEvent) => {
        if (e.ctrlKey || e.metaKey) {
          e.preventDefault();
          // deltaY > 0 = wheel down = zoom out. Magnitude is normalised by
          // the browser already (lines vs pixels), so a constant step is
          // fine for our purposes.
          const delta = e.deltaY > 0 ? -1 : 1;
          map.setZoom(map.getZoom() + delta, { animate: true });
          if (scrollHintTimer.current) clearTimeout(scrollHintTimer.current);
          setScrollHintVisible(false);
        } else {
          // Show the "hold ctrl to zoom" overlay briefly so the user isn't
          // confused why their scroll wheel does nothing on the map.
          setScrollHintVisible(true);
          if (scrollHintTimer.current) clearTimeout(scrollHintTimer.current);
          scrollHintTimer.current = setTimeout(
            () => setScrollHintVisible(false),
            1500
          );
        }
      };
      container.addEventListener("wheel", handleWheel, { passive: false });

      // Click-to-pin-drop: every left-click on the map (outside the school
      // marker's hit area) bubbles a (lat, lng) up to the parent. The parent
      // decides whether to drop a pin, compute distance, etc.
      map.on("click", (evt) => {
        onMapClickRef.current?.(evt.latlng.lat, evt.latlng.lng);
      });

      ringsLayerRef.current = L.layerGroup().addTo(map);
      mapRef.current = map;

      // Tear-down cleanup is owned by the outer effect's return; we leak
      // the wheel listener intentionally because it shares the map's
      // lifetime — Leaflet's `.remove()` rips the container out anyway.
    })();

    return () => {
      cancelled = true;
      if (scrollHintTimer.current) clearTimeout(scrollHintTimer.current);
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
    };
  }, []);

  // Redraw the slab rings whenever the slab list changes. Wipes the layer
  // group rather than diffing — slab counts are small, the redraw is cheap.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const L = await import("leaflet");
      if (cancelled || !mapRef.current || !ringsLayerRef.current) return;
      ringsLayerRef.current.clearLayers();

      const rings = toRings(slabs);
      if (rings.length === 0) return;

      // Iterate largest → smallest when adding to the map. Leaflet stacks
      // later-added layers on top, so reversing the add order puts the
      // SMALLEST circle on top — which is what we want for hit-testing
      // (hovering between two rings hits the smaller of the two enclosing
      // circles, so the right slab tooltip fires). The bullseye palette &
      // opacity are still keyed off the natural inner→outer index so
      // inner rings stay visually denser than outer ones.
      for (let i = rings.length - 1; i >= 0; i--) {
        const ring = rings[i];
        const palette = RING_PALETTE[i % RING_PALETTE.length];
        const circle = L.circle([SCHOOL.lat, SCHOOL.lng], {
          radius: ring.outerKm * 1000,
          color: palette.stroke,
          weight: 1.5,
          fillColor: palette.fill,
          // Inner rings denser, outer rings progressively translucent.
          fillOpacity: Math.max(0.32 - i * 0.04, 0.12),
        });
        const innerLabel =
          ring.innerKm != null
            ? `${ring.innerKm}–${ring.outerKm} km`
            : `≤ ${ring.outerKm} km`;
        circle.bindTooltip(
          `<strong>${ring.name}</strong><br/>${innerLabel} · ${formatAmount(ring.amount, ring.frequency)}`,
          { sticky: true }
        );
        circle.addTo(ringsLayerRef.current!);
      }

      // Fit bounds to the outermost ring so the admin sees the whole reach
      // without manual zooming. Add a small padding so the ring isn't flush
      // against the viewport edge.
      const maxKm = rings[rings.length - 1].outerKm;
      const bounds = L.latLng(SCHOOL.lat, SCHOOL.lng).toBounds(maxKm * 2000);
      mapRef.current.fitBounds(bounds, { padding: [20, 20] });
    })();
    return () => {
      cancelled = true;
    };
  }, [slabs]);

  // Pickup pin layer — separate from rings so address lookups don't force
  // a full redraw.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const L = await import("leaflet");
      if (cancelled || !mapRef.current) return;
      if (pickupMarkerRef.current) {
        pickupMarkerRef.current.remove();
        pickupMarkerRef.current = null;
      }
      if (pickupCircleRef.current) {
        pickupCircleRef.current.remove();
        pickupCircleRef.current = null;
      }
      if (!pickupMarker) return;

      // Proper teardrop pin. SVG keeps the silhouette crisp at any DPI and
      // gives us a known anchor (tip of the pin = the actual address).
      const pinSvg = `
<svg xmlns="http://www.w3.org/2000/svg" width="26" height="36" viewBox="0 0 26 36">
  <path d="M13 1 C19.6 1 25 6.4 25 13 C25 22 13 35 13 35 C13 35 1 22 1 13 C1 6.4 6.4 1 13 1 Z" fill="#dc2626" stroke="white" stroke-width="2" stroke-linejoin="round"/>
  <circle cx="13" cy="13" r="4.5" fill="white"/>
</svg>`;
      const pinIcon = L.divIcon({
        className: "nkps-pickup-pin",
        html: pinSvg,
        iconSize: [26, 36],
        iconAnchor: [13, 34], // tip of the pin
        popupAnchor: [0, -32],
      });
      const m = L.marker([pickupMarker.lat, pickupMarker.lng], { icon: pinIcon })
        .addTo(mapRef.current)
        .bindPopup(
          pickupMarker.label
            ? `<strong>${pickupMarker.label}</strong>${pickupMarker.distanceKm != null ? `<br/>${pickupMarker.distanceKm.toFixed(2)} km from school` : ""}`
            : `${pickupMarker.distanceKm != null ? `${pickupMarker.distanceKm.toFixed(2)} km from school` : "Pickup"}`
        );
      pickupMarkerRef.current = m;

      // Dashed line from school to pickup so admins can eyeball direction.
      pickupCircleRef.current = L.circle([SCHOOL.lat, SCHOOL.lng], {
        radius:
          (pickupMarker.distanceKm ??
            haversineKm(SCHOOL.lat, SCHOOL.lng, pickupMarker.lat, pickupMarker.lng)) * 1000,
        color: "#dc2626",
        weight: 1,
        fill: false,
        dashArray: "4 4",
      }).addTo(mapRef.current);

      mapRef.current.flyTo([pickupMarker.lat, pickupMarker.lng], 14, {
        duration: 0.6,
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [pickupMarker]);

  const recenterOnSchool = () => {
    mapRef.current?.flyTo([SCHOOL.lat, SCHOOL.lng], 13, { duration: 0.5 });
  };

  return (
    // `isolation: isolate` forces the map's stacking context to be self-
    // contained so Leaflet's z-1000 controls don't punch through dialogs
    // and dropdowns rendered elsewhere in the page (e.g. the add-slab modal
    // landing behind the map).
    <div
      className="relative rounded-xl overflow-hidden border border-gray-200 dark:border-border bg-gray-50 dark:bg-muted/30"
      style={{ isolation: "isolate", zIndex: 0 }}
    >
      <div ref={containerRef} className="h-[420px] w-full" />

      {/* Recenter button — sits on top of the map, above the zoom controls
          but still inside the isolated stacking context. */}
      <button
        type="button"
        onClick={recenterOnSchool}
        title="Recenter on NK Public School"
        className="absolute top-3 right-3 z-[2] flex items-center gap-1.5 rounded-md bg-white/95 dark:bg-card/95 backdrop-blur border border-gray-200 dark:border-border px-2.5 py-1.5 text-xs font-medium text-navy-900 dark:text-white shadow-sm hover:bg-white dark:hover:bg-card transition-colors"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <circle cx="12" cy="12" r="3" />
          <path d="M12 2v3M12 19v3M2 12h3M19 12h3" />
        </svg>
        Recenter on school
      </button>

      {/* "Hold ctrl to zoom" hint — fades in for ~1.5s when user wheels
          without the modifier, then disappears. */}
      {scrollHintVisible && (
        <div className="pointer-events-none absolute inset-0 z-[2] flex items-center justify-center">
          <div className="rounded-lg bg-navy-900/85 text-white text-xs font-medium px-3 py-2 backdrop-blur-sm shadow-lg">
            Hold{" "}
            <kbd className="px-1.5 py-0.5 mx-0.5 bg-white/15 rounded text-[10px] font-mono">
              Ctrl
            </kbd>
            (or{" "}
            <kbd className="px-1.5 py-0.5 mx-0.5 bg-white/15 rounded text-[10px] font-mono">
              ⌘
            </kbd>
            ) and scroll to zoom
          </div>
        </div>
      )}
    </div>
  );
}

// Great-circle distance in km. Used as a fallback when the caller didn't
// pre-compute distance for the pickup marker.
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

export const SCHOOL_LOCATION = SCHOOL;
