import type { Metadata } from "next";
import { HeroSlider } from "@/components/home/HeroSlider";
import { QuickLinks } from "@/components/home/QuickLinks";
import { FacilitiesPreview } from "@/components/home/FacilitiesPreview";
import { StatsCounter } from "@/components/home/StatsCounter";
import { LatestUpdates } from "@/components/home/LatestUpdates";
import { Testimonials } from "@/components/home/Testimonials";
import { SchoolEvents } from "@/components/home/SchoolEvents";
import { SectionDivider } from "@nkps/shared/components/SectionDivider";
import { MarqueeStrip } from "@nkps/shared/components/MarqueeStrip";
import { PageTransition } from "@nkps/shared/components/PageTransition";
import { getPageMedia, mediaUrl, getSectionCards } from "@/lib/site-media";
import { getLatestArticles } from "@nkps/shared/lib/articles";
import { buildMetadata } from "@nkps/shared/lib/seo";

export const metadata: Metadata = buildMetadata({
  title: "NK Public School, Murlipura — Established 1985",
  description:
    "NK Public School, Murlipura — the founding NKPS campus in Arya Nagar, Jaipur. English medium, co-educational, Nursery to Class XII with Science and Commerce streams.",
  path: "/",
});

// ISR: revalidate every 60s, plus on-demand via revalidatePath from admin
export const revalidate = 60;

export default async function HomePage() {
  const [media, heroCards, testimonialCards, updateCards, facilityCards, latestArticles] = await Promise.all([
    getPageMedia("home"),
    getSectionCards("hero_slider"),
    getSectionCards("testimonials"),
    getSectionCards("latest_updates"),
    getSectionCards("facilities_preview"),
    getLatestArticles(3),
  ]);

  const statsBackground = mediaUrl(media, "stats_background", "/images/gallery/g10.jpg");

  return (
    <PageTransition>
      <HeroSlider cards={heroCards} />

      <MarqueeStrip
        className="bg-navy-900 text-white/70 py-3"
        items={[
          "Established 1985",
          "English Medium",
          "Co-educational",
          "Nursery to Class XII",
          "Science & Commerce Streams",
          "Holistic Education",
          "Founding NKPS Campus",
          "Murlipura, Jaipur",
        ]}
      />

      <section className="bg-cream-50/60 py-12 md:py-16 px-6">
        <div className="mx-auto max-w-4xl text-center">
          <h2 className="font-heading text-3xl md:text-4xl font-bold text-navy-900">
            NK Public School, Murlipura — Since 1985
          </h2>
          <div className="mx-auto mt-4 h-1 w-16 rounded-full bg-gold-500" />
          <p className="mt-6 text-base md:text-lg leading-relaxed text-gray-700">
            NK Public School, Murlipura is the founding campus of the NKPS group,
            established in 1985 under the vision of Late Shri R.K. Choudhary.
            Located in Arya Nagar, Murlipura, the school offers English-medium,
            co-educational learning from Nursery to Class XII with Science and
            Commerce streams at the senior-secondary level. Built on the
            founder's ideals of discipline, knowledge and human values, we
            combine academic rigour with character education across forty years
            of legacy in Northern Jaipur.
          </p>
          <p className="mt-4 text-sm text-gray-500">
            Arya Nagar, Murlipura, Jaipur — 302039
          </p>
        </div>
      </section>

      <QuickLinks />

      <FacilitiesPreview cards={facilityCards} />

      <StatsCounter backgroundImage={statsBackground} />

      <LatestUpdates cards={updateCards} articles={latestArticles} />

      <SchoolEvents />

      <Testimonials cards={testimonialCards} />
    </PageTransition>
  );
}
