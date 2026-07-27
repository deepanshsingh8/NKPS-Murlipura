"use client";

import { useEffect } from "react";
import { toast } from "sonner";

// Registers the app's service worker and surfaces an update prompt when a new
// version has been deployed. Rendered once in each app's root layout.
//
// Installed PWAs don't hard-refresh the way browser tabs do, so without an
// explicit "reload" nudge users can sit on a stale build indefinitely. When a
// new worker reaches the `waiting` state we show a toast; clicking it tells the
// waiting worker to take over (it calls skipWaiting on that message) and
// reloads once it does.
export function PWARegister() {
  useEffect(() => {
    if (typeof window === "undefined" || !("serviceWorker" in navigator)) {
      return;
    }

    let reloading = false;

    function promptUpdate(worker: ServiceWorker) {
      toast("A new version is available.", {
        duration: Infinity,
        action: {
          label: "Reload",
          onClick: () => worker.postMessage({ type: "SKIP_WAITING" }),
        },
      });
    }

    navigator.serviceWorker
      .register("/sw.js", { scope: "/", updateViaCache: "none" })
      .then((registration) => {
        // A worker already waiting when the page loads (updated in a previous
        // visit but never activated).
        if (registration.waiting && navigator.serviceWorker.controller) {
          promptUpdate(registration.waiting);
        }

        registration.addEventListener("updatefound", () => {
          const installing = registration.installing;
          if (!installing) return;
          installing.addEventListener("statechange", () => {
            // Only prompt on an *update* (a controller already exists), not on
            // the very first install.
            if (
              installing.state === "installed" &&
              navigator.serviceWorker.controller
            ) {
              promptUpdate(installing);
            }
          });
        });
      })
      .catch((err) => {
        console.error("[pwa] service worker registration failed", err);
      });

    // Fired once the newly-activated worker takes control — reload so the page
    // is served by the fresh worker.
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (reloading) return;
      reloading = true;
      window.location.reload();
    });
  }, []);

  return null;
}
