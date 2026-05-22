export default function PortalLoading() {
  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <div className="space-y-4 text-center">
        <div className="mx-auto h-10 w-10 animate-spin rounded-full border-4 border-gray-200 border-t-navy-900" />
        <p className="text-sm text-gray-500">Loading...</p>
      </div>
    </div>
  );
}
