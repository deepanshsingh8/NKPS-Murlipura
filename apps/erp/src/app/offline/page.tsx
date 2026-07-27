import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Offline — NKPS Portal",
};

// Static fallback shown by the service worker when a navigation fails offline.
// Must not fetch or import anything that fetches — it has to render with no
// network.
export default function OfflinePage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 bg-cream-50 p-6 text-center">
      <Image
        src="/icons/icon-192.png"
        alt="NK Public School"
        width={88}
        height={88}
        className="rounded-2xl shadow-md"
      />
      <div className="space-y-2">
        <h1 className="font-heading text-2xl font-bold text-navy-900">
          You&rsquo;re offline
        </h1>
        <p className="max-w-sm text-sm text-navy-900/70">
          The NKPS Portal needs an internet connection. Check your network and
          try again — your data is safe.
        </p>
      </div>
      <Link
        href="/"
        className="rounded-lg bg-navy-900 px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-navy-950"
      >
        Retry
      </Link>
    </div>
  );
}
