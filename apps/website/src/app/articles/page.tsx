import type { Metadata } from "next";
import Link from "next/link";
import Image from "next/image";
import { ArrowRight, Newspaper } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { PageTransition } from "@nkps/shared/components/PageTransition";
import { SectionDivider } from "@nkps/shared/components/SectionDivider";
import { JsonLd } from "@/components/seo/JsonLd";
import { getPublishedArticles } from "@nkps/shared/lib/articles";
import { buildMetadata, breadcrumbJsonLd } from "@nkps/shared/lib/seo";

export const revalidate = 300;

export const metadata: Metadata = buildMetadata({
  title: "News & Articles — NK Public School, Murlipura",
  description:
    "Latest news, announcements and articles from NK Public School, Murlipura — admissions updates, events, achievements, and school life from our Arya Nagar campus in Jaipur.",
  path: "/articles",
});

function formatDate(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

export default async function ArticlesIndexPage() {
  const articles = await getPublishedArticles();

  return (
    <PageTransition>
      <JsonLd
        data={breadcrumbJsonLd([
          { name: "Home", path: "/" },
          { name: "Articles", path: "/articles" },
        ])}
      />
      <PageHeader
        title="News & Articles"
        subtitle="Updates, announcements, and stories from NK Public School"
      />

      <SectionDivider />

      <section className="section-padding">
        <div className="page-container">
          {articles.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-center">
              <div className="rounded-full bg-cream-100 p-6">
                <Newspaper className="h-10 w-10 text-navy-800/30" />
              </div>
              <h2 className="mt-5 text-xl font-heading font-semibold text-navy-900">
                No articles yet
              </h2>
              <p className="mt-2 text-sm text-navy-800/60 max-w-sm">
                Check back soon for the latest news and announcements from the school.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-7">
              {articles.map((article) => (
                <Link
                  key={article.id}
                  href={`/articles/${article.slug}`}
                  className="group rounded-3xl overflow-hidden bg-white border border-gray-100/80 shadow-sm hover:shadow-xl hover:shadow-gold-500/8 hover:border-gold-500/20 transition-all duration-500"
                >
                  <div className="relative h-52 w-full overflow-hidden bg-navy-100">
                    {article.cover_image_url ? (
                      <Image
                        src={article.cover_image_url}
                        alt={article.title}
                        fill
                        sizes="(max-width: 768px) 100vw, (max-width: 1024px) 50vw, 33vw"
                        className="object-cover transition-transform duration-[800ms] ease-out group-hover:scale-[1.08]"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-navy-50 to-cream-100">
                        <Newspaper className="h-12 w-12 text-navy-300" />
                      </div>
                    )}
                    <div className="absolute inset-0 bg-gradient-to-t from-navy-950/20 to-transparent group-hover:from-navy-950/30 transition-all duration-500" />
                  </div>

                  <div className="p-6">
                    <span className="inline-block bg-gold-500/8 text-gold-600 text-xs font-semibold px-3.5 py-1.5 rounded-full border border-gold-500/15 group-hover:bg-gold-500/15 group-hover:border-gold-500/25 transition-all duration-300">
                      {formatDate(article.published_at)}
                    </span>

                    <h2 className="font-heading text-lg font-semibold text-navy-900 mt-3 line-clamp-2 leading-snug">
                      {article.title}
                    </h2>

                    {article.excerpt && (
                      <p className="text-gray-500 text-sm mt-2 leading-relaxed line-clamp-3">
                        {article.excerpt}
                      </p>
                    )}

                    <div className="mt-4 flex items-center gap-1.5 text-navy-900 text-sm font-medium group-hover:text-gold-600 transition-colors duration-300">
                      Read more
                      <ArrowRight className="w-3.5 h-3.5 group-hover:translate-x-1.5 transition-transform duration-300" />
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>
      </section>
    </PageTransition>
  );
}
