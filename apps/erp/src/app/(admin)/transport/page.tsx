"use client";

import Link from "next/link";
import {
  MapPin,
  Bus,
  UserCog,
  UserCheck,
  GitPullRequestArrow,
  ArrowRight,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@nkps/shared/lib/utils";

type TransportTile = {
  label: string;
  description: string;
  href: string;
  icon: LucideIcon;
  accentColor: string;
};

// All transport features share the single `transport` feature key, so reaching
// this page (via middleware) already implies access to every tile — no
// per-tile permission gating needed, unlike the People hub.
const tiles: TransportTile[] = [
  {
    label: "Stops & Fees",
    description:
      "Pickup stops and the distance-based fee charged for each, per academic year.",
    href: "/transport/stops",
    icon: MapPin,
    accentColor: "text-emerald-600 bg-emerald-100 dark:bg-emerald-900/30",
  },
  {
    label: "Buses & Routes",
    description:
      "Fleet vehicles, their drivers and capacity, and the stops each bus serves.",
    href: "/transport/buses",
    icon: Bus,
    accentColor: "text-amber-600 bg-amber-100 dark:bg-amber-900/30",
  },
  {
    label: "Drivers",
    description:
      "Bus-driver roster with contact and licence details and their assigned vehicle.",
    href: "/transport/drivers",
    icon: UserCog,
    accentColor: "text-indigo-600 bg-indigo-100 dark:bg-indigo-900/30",
  },
  {
    label: "Student Assignments",
    description:
      "Which students opt into transport, their pickup stop, and assigned bus.",
    href: "/transport/assignments",
    icon: UserCheck,
    accentColor: "text-blue-600 bg-blue-100 dark:bg-blue-900/30",
  },
  {
    label: "Change Requests",
    description:
      "Review and act on pending pickup-stop and transport opt-in change requests.",
    href: "/transport/changes",
    icon: GitPullRequestArrow,
    accentColor: "text-rose-600 bg-rose-100 dark:bg-rose-900/30",
  },
];

export default function AdminTransportHubPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-bold text-navy-900 dark:text-white">
          Transport
        </h1>
        <p className="text-gray-500 dark:text-gray-400 mt-1">
          Stops and fees, the bus fleet and drivers, student assignments, and
          change requests.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {tiles.map((tile) => {
          const Icon = tile.icon;
          return (
            <Link
              key={tile.href}
              href={tile.href}
              className={cn(
                "group rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-card p-5",
                "transition-all hover:border-gold-500/60 hover:shadow-md hover:-translate-y-0.5"
              )}
            >
              <div className="flex items-start justify-between gap-3">
                <div
                  className={cn(
                    "h-10 w-10 rounded-xl flex items-center justify-center",
                    tile.accentColor
                  )}
                >
                  <Icon className="h-5 w-5" />
                </div>
                <ArrowRight className="h-4 w-4 text-gray-300 dark:text-gray-600 group-hover:text-navy-900 dark:group-hover:text-white transition-colors" />
              </div>
              <h3 className="mt-4 font-heading text-base font-semibold text-navy-900 dark:text-white">
                {tile.label}
              </h3>
              <p className="mt-1 text-sm text-gray-500 dark:text-gray-400 line-clamp-2">
                {tile.description}
              </p>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
