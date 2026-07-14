import type { Metadata } from "next";
import { HeroSlider } from "@/components/home/HeroSlider";
import { QuickLinks } from "@/components/home/QuickLinks";
import { FacilitiesPreview } from "@/components/home/FacilitiesPreview";
import { NewsAchievements } from "@/components/home/NewsAchievements";
import { StatsCounter } from "@/components/home/StatsCounter";
import { Testimonials } from "@/components/home/Testimonials";
import { SchoolEvents } from "@/components/home/SchoolEvents";
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
  const [media, heroCards, testimonialCards, facilityCards, accoladeCards, studentAchievementCards, latestArticles] = await Promise.all([
    getPageMedia("home"),
    getSectionCards("hero_slider"),
    getSectionCards("testimonials"),
    getSectionCards("facilities_preview"),
    getSectionCards("accolades"),
    getSectionCards("student_achievements"),
    getLatestArticles(9),
  ]);

  const statsBackground = mediaUrl(media, "stats_background", "/images/gallery/g10.jpg");

  return (
    <PageTransition>
      <HeroSlider cards={heroCards} />

      <MarqueeStrip
        className="bg-board-deep text-chalk-gold/70 py-3 border-y border-chalk/10"
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

      <section className="py-14 md:py-20 px-6">
        <div className="mx-auto max-w-4xl text-center">
          <h2 className="chalk-underline is-center inline-block text-3xl md:text-5xl text-chalk">
            NK Public School, Murlipura — Since 1985
          </h2>
          <p className="mt-10 text-base md:text-lg leading-relaxed text-chalk-dim">
            NK Public School, Murlipura is the founding campus of the NKPS group,
            established in 1985 under the vision of Late Shri R.K. Choudhary.
            Located in Arya Nagar, Murlipura, the school offers English-medium,
            co-educational learning from Nursery to Class XII with Science and
            Commerce streams at the senior-secondary level. Built on the
            founder&apos;s ideals of discipline, knowledge and human values, we
            combine academic rigour with character education across four decades
            of legacy in Northern Jaipur.
          </p>
          <p className="mt-4 text-sm text-chalk-faint">
            Arya Nagar, Murlipura, Jaipur — 302039
          </p>
        </div>
      </section>

      <QuickLinks />

      <FacilitiesPreview cards={facilityCards} />

      <NewsAchievements
        articles={latestArticles}
        studentAchievements={studentAchievementCards}
        accolades={accoladeCards}
      />

      <StatsCounter backgroundImage={statsBackground} />

      <SchoolEvents />

      <Testimonials cards={testimonialCards} />
    </PageTransition>
  );
}
