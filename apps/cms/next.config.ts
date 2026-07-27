import type { NextConfig } from "next";

// Content-Security-Policy. 'unsafe-inline' on script-src is required by Next's
// App Router (nonce-less inline hydration scripts); the other directives still
// constrain exfiltration and clickjacking. Supabase = storage images.
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https://*.supabase.co",
  "font-src 'self' data:",
  "connect-src 'self' https://*.supabase.co",
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
      // Legacy /admin/* paths that previously lived alongside CMS in the
      // root project. Kept as 308s so external bookmarks still resolve.
      { source: "/admin", destination: "/", permanent: true },
      { source: "/admin/login", destination: "/login", permanent: true },
      { source: "/admin/articles", destination: "/articles", permanent: true },
      { source: "/admin/articles/:path*", destination: "/articles/:path*", permanent: true },
      { source: "/admin/gallery", destination: "/gallery", permanent: true },
      { source: "/admin/gallery/:path*", destination: "/gallery/:path*", permanent: true },
      { source: "/admin/contact", destination: "/contact", permanent: true },
      { source: "/admin/contact/:path*", destination: "/contact/:path*", permanent: true },
      { source: "/admin/transfer-certificates", destination: "/transfer-certificates", permanent: true },
      { source: "/admin/transfer-certificates/:path*", destination: "/transfer-certificates/:path*", permanent: true },
      { source: "/admin/site-media", destination: "/site-media", permanent: true },
      { source: "/admin/disclosure", destination: "/disclosure", permanent: true },
      { source: "/admin/content/:path*", destination: "/:path*", permanent: true },
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
