import type { Metadata } from "next";
import Link from "next/link";
import Image from "next/image";
import { notFound } from "next/navigation";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ArrowLeft, Calendar, User } from "lucide-react";
import { PageTransition } from "@nkps/shared/components/PageTransition";
import { getArticleBySlug, getPublishedArticles } from "@nkps/shared/lib/articles";
import { SITE_URL } from "@nkps/shared/lib/seo";

export const revalidate = 300;

interface PageProps {
  params: Promise<{ slug: string }>;
}

export async function generateStaticParams() {
  const articles = await getPublishedArticles();
  return articles.map((a) => ({ slug: a.slug }));
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const article = await getArticleBySlug(slug);
  if (!article) {
    return { title: "Article Not Found" };
  }

  const description =
    article.meta_description ||
    article.excerpt ||
    `Read "${article.title}" on NK Public School.`;
  const canonical = `${SITE_URL}/articles/${article.slug}`;
  const images = article.cover_image_url ? [article.cover_image_url] : [];

  return {
    title: article.title,
    description,
    alternates: { canonical },
    openGraph: {
      type: "article",
      title: article.title,
      description,
      url: canonical,
      siteName: "NK Public School",
      images,
      publishedTime: article.published_at ?? undefined,
      modifiedTime: article.updated_at,
      authors: article.author_name ? [article.author_name] : undefined,
      tags: article.tags.length > 0 ? article.tags : undefined,
    },
    twitter: {
      card: "summary_large_image",
      title: article.title,
      description,
      images,
    },
  };
}

function formatLongDate(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

export default async function ArticleDetailPage({ params }: PageProps) {
  const { slug } = await params;
  const article = await getArticleBySlug(slug);
  if (!article) notFound();

  const description =
    article.meta_description ||
    article.excerpt ||
    `Read "${article.title}" on NK Public School.`;
  const canonical = `${SITE_URL}/articles/${article.slug}`;
  const authorName = article.author_name || "NK Public School";

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "NewsArticle",
    headline: article.title,
    description,
    image: article.cover_image_url ? [article.cover_image_url] : undefined,
    datePublished: article.published_at,
    dateModified: article.updated_at,
    author: { "@type": "Organization", name: authorName },
    publisher: {
      "@type": "Organization",
      name: "NK Public School",
      logo: { "@type": "ImageObject", url: `${SITE_URL}/logo.png` },
    },
    mainEntityOfPage: { "@type": "WebPage", "@id": canonical },
    keywords: article.tags.length > 0 ? article.tags.join(", ") : undefined,
  };

  return (
    <PageTransition>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />

      {/* Hero */}
      <section className="relative w-full bg-navy-900 bg-gradient-to-br from-navy-900 via-navy-800 to-navy-900 pt-24 pb-12 sm:pt-32 sm:pb-16 overflow-hidden">
        <div
          className="absolute inset-0 opacity-[0.03]"
          style={{
            backgroundImage:
              "radial-gradient(circle, rgba(255,255,255,0.8) 1px, transparent 1px)",
            backgroundSize: "20px 20px",
          }}
        />
        <div className="relative mx-auto max-w-4xl px-6">
          <Link
            href="/articles"
            className="inline-flex items-center gap-1.5 text-sm text-gold-400 hover:text-gold-300 transition-colors mb-6"
          >
            <ArrowLeft className="h-4 w-4" />
            All articles
          </Link>

          {article.tags.length > 0 && (
            <div className="flex flex-wrap gap-2 mb-4">
              {article.tags.map((tag) => (
                <span
                  key={tag}
                  className="text-xs bg-white/10 text-white/80 px-3 py-1 rounded-full border border-white/10"
                >
                  {tag}
                </span>
              ))}
            </div>
          )}

          <h1 className="font-heading text-3xl md:text-4xl lg:text-5xl font-bold text-white leading-tight">
            {article.title}
          </h1>

          <div className="flex flex-wrap items-center gap-4 mt-6 text-sm text-gray-300">
            {article.published_at && (
              <span className="inline-flex items-center gap-1.5">
                <Calendar className="h-4 w-4 text-gold-400" />
                {formatLongDate(article.published_at)}
              </span>
            )}
            <span className="inline-flex items-center gap-1.5">
              <User className="h-4 w-4 text-gold-400" />
              {authorName}
            </span>
          </div>
        </div>
      </section>

      {/* Cover image */}
      {article.cover_image_url && (
        <div className="mx-auto max-w-4xl px-6 -mt-6">
          <div className="relative aspect-[16/9] rounded-3xl overflow-hidden shadow-xl bg-navy-100">
            <Image
              src={article.cover_image_url}
              alt={article.title}
              fill
              priority
              sizes="(max-width: 1024px) 100vw, 1024px"
              className="object-cover"
            />
          </div>
        </div>
      )}

      {/* Body */}
      <article className="section-padding">
        <div className="mx-auto max-w-3xl px-6">
          <div className="bg-paper rounded-2xl shadow-[0_16px_30px_-14px_rgba(0,0,0,0.55)] p-6 sm:p-10">
            {article.excerpt && (
              <p className="text-lg text-gray-700 font-medium leading-relaxed mb-8 pb-8 border-b border-gray-200">
                {article.excerpt}
              </p>
            )}

            <div className="article-prose">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {article.content}
              </ReactMarkdown>
            </div>

            <div className="mt-12 pt-8 border-t border-gray-200">
              <Link
                href="/articles"
                className="inline-flex items-center gap-1.5 text-sm font-medium text-navy-900 hover:text-gold-600 transition-colors"
              >
                <ArrowLeft className="h-4 w-4" />
                Back to all articles
              </Link>
            </div>
          </div>
        </div>
      </article>
    </PageTransition>
  );
}
