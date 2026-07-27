import type { NextConfig } from "next";

// Content-Security-Policy. 'unsafe-inline' on script-src is required by Next's
// App Router (nonce-less inline hydration scripts); the other directives still
// constrain exfiltration and clickjacking. Origins:
//   - Supabase: storage images (img) + REST/auth (connect)
//   - OpenStreetMap tiles: transport slab map base layer (img)
//   - Nominatim: transport address geocoding fallback fetch (connect)
//   - Google Maps JS API: Places Autocomplete on the transport address fields.
//     The js-api-loader injects scripts from maps.googleapis.com/maps.gstatic.com
//     (script), the widget XHRs to maps.googleapis.com (connect), and its
//     dropdown shows the "powered by Google" logo from maps.gstatic.com (img).
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' https://maps.googleapis.com https://maps.gstatic.com",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https://*.supabase.co https://*.tile.openstreetmap.org https://tile.openstreetmap.org https://maps.googleapis.com https://maps.gstatic.com",
  "font-src 'self' data:",
  "connect-src 'self' https://*.supabase.co https://nominatim.openstreetmap.org https://maps.googleapis.com",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  // PWA: the service worker and web-app manifest are same-origin. These
  // fall back to default-src 'self' if omitted, but are made explicit so
  // the fallback chain doesn't have to be reasoned about.
  "worker-src 'self'",
  "manifest-src 'self'",
].join("; ");

const nextConfig: NextConfig = {
  transpilePackages: ["@nkps/shared"],
  images: {
    unoptimized: true,
    localPatterns: [
      {
        pathname: "/images/**",
        search: "",
      },
    ],
    remotePatterns: [
      {
        protocol: "https",
        hostname: "**.supabase.co",
      },
    ],
  },
  async redirects() {
    return [
      // Legacy /admin/* paths from the pre-split monorepo. Kept as 308s so
      // external bookmarks still resolve.
      { source: "/admin", destination: "/", permanent: true },
      { source: "/admin/login", destination: "/login", permanent: true },
      { source: "/admin/users", destination: "/people/users", permanent: true },
      { source: "/admin/students", destination: "/people/students", permanent: true },
      { source: "/admin/students/:path*", destination: "/people/students/:path*", permanent: true },
      { source: "/admin/staff", destination: "/people/staff", permanent: true },
      { source: "/admin/staff/:path*", destination: "/people/staff/:path*", permanent: true },
      { source: "/admin/exams", destination: "/exams", permanent: true },
      { source: "/admin/exams/:path*", destination: "/exams/:path*", permanent: true },
      { source: "/admin/fees", destination: "/fees", permanent: true },
      { source: "/admin/fees/:path*", destination: "/fees/:path*", permanent: true },
      { source: "/admin/timetable", destination: "/timetable", permanent: true },
      { source: "/admin/timetable/:path*", destination: "/timetable/:path*", permanent: true },
      { source: "/admin/calendar", destination: "/calendar", permanent: true },
      { source: "/admin/calendar/:path*", destination: "/calendar/:path*", permanent: true },
      { source: "/admin/attendance", destination: "/attendance", permanent: true },
      { source: "/admin/academics", destination: "/academics", permanent: true },
      { source: "/admin/academics/:path*", destination: "/academics/:path*", permanent: true },
      { source: "/admin/registrations", destination: "/registrations", permanent: true },
      { source: "/erp-login", destination: "/login", permanent: true },
    ];
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "Content-Security-Policy", value: CSP },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-DNS-Prefetch-Control", value: "on" },
          {
            key: "Strict-Transport-Security",
            value: "max-age=31536000; includeSubDomains",
          },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=()",
          },
        ],
      },
      {
        // The service worker must never be cached, or users get stuck on a
        // stale app version. Also pin the correct MIME type.
        source: "/sw.js",
        headers: [
          {
            key: "Content-Type",
            value: "application/javascript; charset=utf-8",
          },
          {
            key: "Cache-Control",
            value: "no-cache, no-store, must-revalidate",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
