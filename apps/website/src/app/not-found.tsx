import Link from "next/link";

export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-6 text-center">
      <h1 className="font-heading text-8xl font-bold text-navy-900">404</h1>
      <h2 className="mt-4 font-heading text-2xl font-semibold text-navy-800">
        Page Not Found
      </h2>
      <p className="mt-3 max-w-md text-gray-600">
        The page you&apos;re looking for doesn&apos;t exist or has been moved.
      </p>
      <Link
        href="/"
        className="mt-8 rounded-xl bg-navy-900 px-8 py-3 text-white transition-colors hover:bg-navy-800"
      >
        Go Home
      </Link>
    </div>
  );
}
