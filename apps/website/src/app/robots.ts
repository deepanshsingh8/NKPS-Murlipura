import { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: ["/admin", "/cms", "/erp", "/api"],
      },
    ],
    sitemap: "https://www.nkpsmurlipura.com/sitemap.xml",
  };
}
