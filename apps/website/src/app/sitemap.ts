import { MetadataRoute } from "next";
import { getPublishedArticles } from "@nkps/shared/lib/articles";
import { SITE_URL } from "@nkps/shared/lib/seo";
import { getProspectusDocuments } from "@/lib/prospectus";
import { getHolidayHomework } from "@/lib/holiday-homework";

// Regenerate hourly so articles and documents published from the CMS show up
// without a redeploy (a sitemap is otherwise built once and cached).
export const revalidate = 3600;

type Entry = MetadataRoute.Sitemap[number];

const page = (
  path: string,
  changeFrequency: Entry["changeFrequency"],
  priority: number,
  lastModified?: string
): Entry => ({
  url: `${SITE_URL}${path}`,
  changeFrequency,
  priority,
  // Only emit lastmod when we know it. A build-time "now" on every URL is
  // ignored by Google and makes real changes harder to spot.
  ...(lastModified ? { lastModified } : {}),
});

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const [articles, prospectus, homework] = await Promise.all([
    getPublishedArticles().catch((err) => {
      console.error("sitemap: failed to load articles", err);
      return [];
    }),
    getProspectusDocuments(),
    getHolidayHomework(),
  ]);

  const latestArticle = articles
    .map((a) => a.updated_at)
    .sort()
    .at(-1);

  const staticEntries: MetadataRoute.Sitemap = [
    page("", "weekly", 1, latestArticle),
    page("/about", "monthly", 0.8),
    page("/academics", "monthly", 0.8),
    page("/admissions", "monthly", 0.9),
    page("/student-life", "monthly", 0.7),
    page("/facilities", "monthly", 0.7),
    page("/gallery", "weekly", 0.6),
    page("/articles", "weekly", 0.7, latestArticle),
    page("/academic-calendar", "weekly", 0.6),
    page("/alumni", "monthly", 0.6),
    page("/contact", "monthly", 0.8),
    page("/transfer-certificates", "weekly", 0.5),
    page("/mandatory-public-disclosure", "yearly", 0.5),
    page("/for-parents", "yearly", 0.5),
    // These pages are noindex while empty (see their generateMetadata), so
    // only list them once the CMS has documents.
    ...(prospectus.length > 0 ? [page("/prospectus", "monthly", 0.7)] : []),
    ...(homework.length > 0 ? [page("/holiday-homework", "weekly", 0.6)] : []),
  ];

  const articleEntries: MetadataRoute.Sitemap = articles.map((a) =>
    page(`/articles/${a.slug}`, "monthly", 0.6, a.updated_at)
  );

  return [...staticEntries, ...articleEntries];
}
