export default function StudentLoading() {
  return (
    <div className="space-y-6">
      <div className="h-8 w-48 rounded-lg bg-gray-200 animate-pulse" />
      <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
        {[1, 2, 3].map((i) => (
          <div
            key={i}
            className="rounded-2xl border border-gray-200 bg-white p-6 animate-pulse dark:border-gray-800 dark:bg-gray-900"
          >
            <div className="mb-3 h-4 w-24 rounded bg-gray-200 dark:bg-gray-700" />
            <div className="h-8 w-16 rounded bg-gray-200 dark:bg-gray-700" />
          </div>
        ))}
      </div>
      <div className="h-64 rounded-2xl border border-gray-200 bg-white animate-pulse dark:border-gray-800 dark:bg-gray-900" />
    </div>
  );
}
