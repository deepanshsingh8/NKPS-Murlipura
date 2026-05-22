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
