"use client";

import { useMemo, useState, useImperativeHandle, forwardRef } from "react";
import { Loader2, Search, MapPin } from "lucide-react";
import { Input } from "@nkps/shared/components/ui/input";
import { Button } from "@nkps/shared/components/ui/button";
import { Label } from "@nkps/shared/components/ui/label";
import {
  PlacesAutocompleteInput,
  isGooglePlacesConfigured,
  type PlaceSelection,
} from "@nkps/shared/components/PlacesAutocompleteInput";
import { toast } from "sonner";
import type { TransportFareSlab } from "@nkps/shared/types";
import { SCHOOL_LOCATION, haversineKm } from "./TransportSlabsMap";

// Nominatim fallback for environments without a Google Places key. We hit
// it only on an explicit user action — Nominatim's TOS disallows the
// per-keystroke usage that real autocomplete would imply.
const NOMINATIM_BASE = "https://nominatim.openstreetmap.org/search";

interface NominatimResult {
  lat: number;
  lng: number;
  display_name: string;
}

async function geocodeNominatim(query: string): Promise<NominatimResult | null> {
  const url = new URL(NOMINATIM_BASE);
  url.searchParams.set("q", query);
  url.searchParams.set("format", "json");
  url.searchParams.set("limit", "1");
  url.searchParams.set("countrycodes", "in");
  const res = await fetch(url.toString(), {
    headers: { Accept: "application/json" },
  });
  if (!res.ok) return null;
  const json = (await res.json()) as {
    lat: string;
    lon: string;
    display_name: string;
  }[];
  if (!json.length) return null;
  return {
    lat: parseFloat(json[0].lat),
    lng: parseFloat(json[0].lon),
    display_name: json[0].display_name,
  };
}

function pickSlab(distanceKm: number, slabs: TransportFareSlab[]) {
  // Look for an active slab whose [min, max] range contains the distance.
  // The schema permits null min/max (open intervals), so treat null min as
  // 0 and null max as +Infinity for matching purposes.
  const candidates = slabs.filter((s) => s.is_active);
  for (const s of candidates.sort(
    (a, b) =>
      Number(a.distance_km_min ?? 0) - Number(b.distance_km_min ?? 0)
  )) {
    const min = s.distance_km_min == null ? 0 : Number(s.distance_km_min);
    const max =
      s.distance_km_max == null ? Number.POSITIVE_INFINITY : Number(s.distance_km_max);
    if (distanceKm >= min && distanceKm <= max) return s;
  }
  return null;
}

interface Props {
  slabs: TransportFareSlab[];
  onResult: (
    pin: { lat: number; lng: number; label: string; distanceKm: number } | null
  ) => void;
}

export interface AddressFareLookupHandle {
  // Externally drop a result — used by the parent when a user clicks the
  // map to pin-drop. Bypasses the input flow entirely.
  setResultFromCoords: (lat: number, lng: number, label?: string) => void;
}

export const AddressFareLookup = forwardRef<AddressFareLookupHandle, Props>(
  function AddressFareLookup({ slabs, onResult }, ref) {
    const [query, setQuery] = useState("");
    const [loading, setLoading] = useState(false);
    // We deliberately don't cache the slab here — it's derived on every
    // render from `slabs` + `result.distanceKm` so adding a new slab
    // immediately re-evaluates the existing result (previously the panel
    // froze "No matching slab" answers from before the slab existed).
    const [result, setResult] = useState<{
      address: string;
      distanceKm: number;
    } | null>(null);

    const matchedSlab = useMemo<TransportFareSlab | null>(
      () => (result ? pickSlab(result.distanceKm, slabs) : null),
      [result, slabs]
    );

    const placesReady = isGooglePlacesConfigured();

    const applyResult = (
      lat: number,
      lng: number,
      address: string,
      pinLabel: string
    ) => {
      const distance = haversineKm(
        SCHOOL_LOCATION.lat,
        SCHOOL_LOCATION.lng,
        lat,
        lng
      );
      setResult({ address, distanceKm: distance });
      onResult({ lat, lng, label: pinLabel, distanceKm: distance });
    };

    useImperativeHandle(ref, () => ({
      setResultFromCoords: (lat: number, lng: number, label?: string) => {
        const friendlyLabel =
          label ?? `Pinned (${lat.toFixed(5)}, ${lng.toFixed(5)})`;
        setQuery(friendlyLabel);
        applyResult(lat, lng, friendlyLabel, friendlyLabel.split(",")[0]);
      },
    }));

    // Manual lookup path — fires Nominatim when the user has typed
    // something and there's no Places key (or Places didn't yield a pick).
    const handleManualLookup = async () => {
      const q = query.trim();
      if (q.length < 4) {
        toast.error("Type a more specific address");
        return;
      }
      setLoading(true);
      try {
        const geo = await geocodeNominatim(q);
        if (!geo) {
          toast.error("Couldn't find that address");
          setResult(null);
          onResult(null);
          return;
        }
        applyResult(
          geo.lat,
          geo.lng,
          geo.display_name,
          geo.display_name.split(",")[0] ?? "Pickup"
        );
      } catch {
        toast.error("Address lookup failed");
      } finally {
        setLoading(false);
      }
    };

    const handlePlaceSelect = (place: PlaceSelection) => {
      applyResult(
        place.lat,
        place.lng,
        place.address,
        place.address.split(",")[0] ?? "Pickup"
      );
    };

    return (
      <div className="rounded-xl border border-gray-200 dark:border-border bg-gray-50 dark:bg-muted/30 p-4">
        <div className="flex items-center gap-2 mb-2">
          <MapPin className="h-4 w-4 text-blue-600" />
          <Label className="text-sm font-medium text-navy-900 dark:text-white">
            Address → fare lookup
          </Label>
        </div>
        <p className="text-[11px] text-gray-500 dark:text-gray-400 mb-3">
          Type a parent&apos;s pickup address (or click anywhere on the map to drop
          a pin). We compute the straight-line distance from the school and pick
          the matching slab.
        </p>
        <div className="flex gap-2">
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400 z-[1]" />
            {placesReady ? (
              <PlacesAutocompleteInput
                value={query}
                onValueChange={setQuery}
                onSelect={handlePlaceSelect}
                bias={{
                  lat: SCHOOL_LOCATION.lat,
                  lng: SCHOOL_LOCATION.lng,
                  radiusMeters: 25_000,
                }}
                placeholder="Type address — suggestions appear as you type"
                className="pl-10"
                disabled={loading}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    // Allow Enter to fall back to manual lookup when the
                    // user hasn't picked an autocomplete suggestion yet.
                    handleManualLookup();
                  }
                }}
              />
            ) : (
              <Input
                placeholder="e.g. Tonk Road, Sanganer, Jaipur"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    handleManualLookup();
                  }
                }}
                className="pl-10"
                disabled={loading}
              />
            )}
          </div>
          {!placesReady && (
            <Button
              onClick={handleManualLookup}
              disabled={loading || query.trim().length < 4}
              className="bg-navy-900 hover:bg-navy-800 text-white"
            >
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Lookup"}
            </Button>
          )}
        </div>
        {!placesReady && (
          <p className="text-[10px] text-gray-400 mt-1">
            Set{" "}
            <code className="font-mono">NEXT_PUBLIC_GOOGLE_MAPS_API_KEY</code>{" "}
            to enable real-time address suggestions.
          </p>
        )}

        {result && (
          <div className="mt-4 rounded-lg bg-white dark:bg-card border border-gray-200 dark:border-border p-3 space-y-2">
            <div>
              <p className="text-[11px] uppercase tracking-wider text-gray-400">
                Matched address
              </p>
              <p className="text-sm text-navy-900 dark:text-white">
                {result.address}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-4 text-xs">
              <div>
                <span className="text-gray-400">Distance</span>{" "}
                <span className="font-semibold text-navy-900 dark:text-white tabular-nums">
                  {result.distanceKm.toFixed(2)} km
                </span>
              </div>
              {matchedSlab ? (
                <div>
                  <span className="text-gray-400">Suggested slab</span>{" "}
                  <span className="font-semibold text-emerald-700 dark:text-emerald-400">
                    {matchedSlab.name}
                  </span>{" "}
                  <span className="text-gray-500">
                    ·{" "}
                    {new Intl.NumberFormat("en-IN", {
                      style: "currency",
                      currency: "INR",
                      maximumFractionDigits: 0,
                    }).format(Number(matchedSlab.amount))}
                    {matchedSlab.frequency !== "one_time"
                      ? `/${matchedSlab.frequency.replace("_", " ")}`
                      : ""}
                  </span>
                </div>
              ) : (
                <div className="text-amber-700 dark:text-amber-400">
                  No matching slab — add one that covers {result.distanceKm.toFixed(1)} km.
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    );
  }
);
