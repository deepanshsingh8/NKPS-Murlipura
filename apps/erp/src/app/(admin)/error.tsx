"use client";

import { useEffect } from "react";
import { AlertTriangle } from "lucide-react";

export default function AdminError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Admin error:", error);
  }, [error]);

  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border border-red-200 bg-red-50 p-12 text-center dark:border-red-900/40 dark:bg-red-950/20">
      <AlertTriangle className="h-12 w-12 text-red-500" />
      <h2 className="mt-4 text-lg font-semibold text-gray-900 dark:text-white">
        Something went wrong
      </h2>
      <p className="mt-2 max-w-sm text-sm text-gray-600 dark:text-gray-400">
        An error occurred while loading this page. Please try again.
      </p>
      <button
        onClick={reset}
        className="mt-6 rounded-xl bg-navy-900 px-6 py-2.5 text-sm font-medium text-white transition-colors hover:bg-navy-800"
      >
        Try Again
      </button>
    </div>
  );
}
