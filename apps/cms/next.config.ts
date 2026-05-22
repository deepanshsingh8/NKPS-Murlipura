import type { NextConfig } from "next";

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
