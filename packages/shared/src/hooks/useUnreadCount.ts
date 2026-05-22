"use client";

import { useEffect, useState } from "react";
import { adminFetch } from "@nkps/shared/lib/admin-api";

type UseUnreadCountOptions = {
  contact?: boolean;
  registrations?: boolean;
  feeChangeRequests?: boolean;
};

export function useUnreadCount({
  contact = false,
  registrations = false,
  feeChangeRequests = false,
}: UseUnreadCountOptions = {}) {
  const [unreadCount, setUnreadCount] = useState(0);
  const [pendingRegistrationCount, setPendingRegistrationCount] = useState(0);
  const [pendingFeeChangeRequestCount, setPendingFeeChangeRequestCount] =
    useState(0);

  useEffect(() => {
    if (!contact && !registrations && !feeChangeRequests) return;
    let mounted = true;

    const fetchCounts = async () => {
      try {
        const tasks: Array<Promise<unknown>> = [];

        if (contact) {
          tasks.push(
            adminFetch("/api/contact/unread-count").then(async (res) => {
              if (mounted && res.ok) {
                const data = await res.json();
                setUnreadCount(data.count ?? 0);
              }
            })
          );
        }

        if (registrations) {
          tasks.push(
            adminFetch("/api/registrations/pending-count").then(async (res) => {
              if (mounted && res.ok) {
                const data = await res.json();
                setPendingRegistrationCount(data.count ?? 0);
              }
            })
          );
        }

        if (feeChangeRequests) {
          tasks.push(
            adminFetch("/api/fees/change-requests/pending-count").then(
              async (res) => {
                if (mounted && res.ok) {
                  const data = await res.json();
                  setPendingFeeChangeRequestCount(data.count ?? 0);
                }
              }
            )
          );
        }

        await Promise.all(tasks);
      } catch {
        // Silently fail — badges just won't show
      }
    };

    fetchCounts();
    const interval = setInterval(fetchCounts, 60_000);

    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, [contact, registrations, feeChangeRequests]);

  return {
    unreadCount,
    pendingRegistrationCount,
    pendingFeeChangeRequestCount,
  };
}
