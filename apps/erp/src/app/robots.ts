import type { MetadataRoute } from "next";

// Private, login-gated app. Crawling is deliberately ALLOWED: de-indexing is
// done by the noindex robots meta (layout metadata) and the X-Robots-Tag header
// (next.config.ts). A `Disallow: /` here would stop Google from ever seeing
// that noindex, so already-linked URLs (e.g. the login page) could stay in the
// index as URL-only results. The proxy matcher skips paths containing a dot,
// so /robots.txt is served publicly rather than redirected to login.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: "*", allow: "/" },
  };
}
