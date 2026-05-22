"use client";

/// <reference types="google.maps" />

import { useEffect, useRef, useState } from "react";
import { setOptions, importLibrary } from "@googlemaps/js-api-loader";
import { Input } from "@nkps/shared/components/ui/input";
import { cn } from "@nkps/shared/lib/utils";

// Drop-in replacement for an address <Input>. When a Google Maps Places key
// is configured (NEXT_PUBLIC_GOOGLE_MAPS_API_KEY), the input grows real-time
// suggestions via Google's Autocomplete widget. When no key is configured,
// it degrades to a plain Input — the caller can still wire a manual
// "Search" button against Nominatim or similar.
//
// Why this lives in @nkps/shared:
//   - Two callers (Transport address lookup, per-student pickup field).
//   - The loader is global — multiple components would otherwise race each
//     other to load the Google Maps JS bundle. Sharing the loader keeps the
//     bundle download to one.

export interface PlaceSelection {
  address: string; // user-friendly formatted address
  lat: number;
  lng: number;
  // Raw place id, useful for downstream API lookups (driving distance, etc.)
  placeId?: string;
}

interface Props {
  value: string;
  onValueChange: (value: string) => void;
  // Fires when the user picks a real Google place from the dropdown. Not
  // fired on plain typing (use `onValueChange` for that).
  onSelect?: (place: PlaceSelection) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  // Bias suggestions toward this center. Helpful for school transport so
  // local matches outrank far-away ones.
  bias?: { lat: number; lng: number; radiusMeters?: number };
  // Restrict suggestions to a single country (ISO code, lower-case).
  // Defaults to "in" — the school is in India.
  country?: string;
  onKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => void;
}

// The new (v2) functional API memoises options + lazy-loads the script,
// so calling setOptions repeatedly with the same key is a no-op. We still
// gate it behind a module flag to avoid touching the loader at all when
// the key isn't configured (which would surface "Loader must not be called
// without an apiKey" in the console).
let optionsApplied = false;
function ensureLoaderOptions(apiKey: string) {
  if (optionsApplied) return;
  setOptions({ key: apiKey, v: "weekly" });
  optionsApplied = true;
}

export function PlacesAutocompleteInput({
  value,
  onValueChange,
  onSelect,
  placeholder,
  disabled,
  className,
  bias,
  country = "in",
  onKeyDown,
}: Props) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const autocompleteRef = useRef<google.maps.places.Autocomplete | null>(null);
  const [ready, setReady] = useState(false);
  const [loadError, setLoadError] = useState(false);

  const apiKey =
    typeof process !== "undefined"
      ? process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY
      : undefined;

  useEffect(() => {
    if (!apiKey || !inputRef.current) return;
    let cancelled = false;
    let listener: google.maps.MapsEventListener | null = null;

    (async () => {
      try {
        ensureLoaderOptions(apiKey);
        // The Places library is the only one we need — Google's loader
        // pulls in the rest of Maps JS lazily only if other callers ask
        // for it.
        const places = (await importLibrary(
          "places"
        )) as google.maps.PlacesLibrary;
        if (cancelled || !inputRef.current) return;

        // Construct the classic Autocomplete widget. Google has flagged
        // this as "legacy" in favour of PlaceAutocompleteElement (March
        // 2025), but the widget keeps working and the new element has a
        // different DOM contract; we'll migrate when the deprecation
        // shortens. fields=`geometry,formatted_address,place_id` keeps
        // session-token billing on the cheap Autocomplete tier.
        const ac = new places.Autocomplete(inputRef.current, {
          fields: ["geometry", "formatted_address", "place_id", "name"],
          componentRestrictions: country ? { country: [country] } : undefined,
          types: ["geocode", "establishment"],
        });

        if (bias) {
          const center = new google.maps.LatLng(bias.lat, bias.lng);
          ac.setBounds(
            new google.maps.Circle({
              center,
              radius: bias.radiusMeters ?? 25_000,
            }).getBounds() ?? undefined
          );
        }

        listener = ac.addListener("place_changed", () => {
          const place = ac.getPlace();
          if (!place.geometry?.location) return;
          const lat = place.geometry.location.lat();
          const lng = place.geometry.location.lng();
          const addr = place.formatted_address ?? place.name ?? "";
          onValueChange(addr);
          onSelect?.({
            address: addr,
            lat,
            lng,
            placeId: place.place_id,
          });
        });

        autocompleteRef.current = ac;
        setReady(true);
      } catch {
        // Most likely an invalid API key or referrer restriction. We
        // surface a flag so the caller can render a fallback button.
        if (!cancelled) setLoadError(true);
      }
    })();

    return () => {
      cancelled = true;
      if (listener) listener.remove();
      // Google doesn't expose a clean destroy() for Autocomplete; the
      // widget is tied to the input lifetime. Strip the listener and let
      // GC handle the rest when the input unmounts.
      autocompleteRef.current = null;
    };
    // Re-binding the Autocomplete when bias/country changes is fine and
    // cheap — the place_changed listener is also re-wired so callers see
    // the up-to-date onSelect closure.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiKey, country, bias?.lat, bias?.lng, bias?.radiusMeters]);

  return (
    <Input
      ref={inputRef}
      value={value}
      onChange={(e) => onValueChange(e.target.value)}
      onKeyDown={onKeyDown}
      placeholder={
        placeholder ??
        (apiKey
          ? ready
            ? "Type an address — suggestions appear below"
            : loadError
              ? "Type address (autocomplete unavailable)"
              : "Loading suggestions…"
          : "Type address")
      }
      disabled={disabled}
      className={cn(className)}
      // Google's widget injects its own dropdown into a <div class="pac-container">
      // appended to <body>. We don't need to render anything else here.
      autoComplete="off"
    />
  );
}

export function isGooglePlacesConfigured(): boolean {
  return Boolean(
    typeof process !== "undefined" &&
      process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY
  );
}
