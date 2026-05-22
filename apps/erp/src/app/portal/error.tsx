"use client";

import { useEffect } from "react";

export default function PortalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Portal error:", error);
  }, [error]);

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center px-6 text-center">
      <h1 className="font-heading text-4xl font-bold text-navy-900">Oops</h1>
      <h2 className="mt-4 text-lg font-semibold text-navy-800">
        Something went wrong
      </h2>
      <p className="mt-3 max-w-md text-gray-600">
        An error occurred. Please try again.
      </p>
      <button
        onClick={reset}
        className="mt-8 rounded-xl bg-navy-900 px-8 py-3 text-white transition-colors hover:bg-navy-800"
      >
        Try Again
      </button>
    </div>
  );
}
