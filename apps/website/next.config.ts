import type { NextConfig } from "next";

// Content-Security-Policy. 'unsafe-inline' on script-src is required because
// Next's App Router injects inline hydration/bootstrap scripts without a nonce;
// the remaining directives (connect/img/frame/object/base/form) still constrain
// exfiltration and clickjacking. Origins: Supabase (storage images), Google
// Maps (contact-page location embed), Google Analytics (gtag via
// @next/third-parties).
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' https://www.googletagmanager.com",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https://*.supabase.co https://www.google-analytics.com",
  "font-src 'self' data:",
  "connect-src 'self' https://*.supabase.co https://www.googletagmanager.com https://www.google-analytics.com https://*.analytics.google.com",
  "frame-src 'self' https://www.google.com",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

const nextConfig: NextConfig = {
  transpilePackages: ["@nkps/shared"],
  images: {
    // Public marketing site: let Next optimize images (responsive WebP +
    // long-lived CDN cache) so we don't ship 1-2MB originals to mobile. The
    // config below keeps Vercel transformation usage low — webp-only, a single
    // quality, a 31-day minimum cache TTL, and a bounded set of size buckets.
    // (cms/erp keep unoptimized:true — auth-gated, low-traffic, not worth the quota.)
    minimumCacheTTL: 2678400,
    formats: ["image/webp"],
    qualities: [75],
    deviceSizes: [640, 750, 828, 1080, 1200, 1920],
    imageSizes: [48, 64, 96, 128, 256, 384],
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
    ];
  },
};

export default nextConfig;
