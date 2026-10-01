import { Metadata } from "next";
import Image from "next/image";
import { PageHeader } from "@/components/layout/PageHeader";
import { VisionMission } from "@/components/about/VisionMission";
import { LegacyTimeline } from "@/components/about/LegacyTimeline";
import { FounderTribute } from "@/components/about/FounderTribute";
import { LeadershipGrid } from "@/components/about/LeadershipGrid";
import { WhyChooseUs } from "@/components/about/WhyChooseUs";
import { AchievementsCounter } from "@/components/about/AchievementsCounter";
import { PageTransition } from "@nkps/shared/components/PageTransition";
import { SectionDivider } from "@nkps/shared/components/SectionDivider";
import { JsonLd } from "@/components/seo/JsonLd";
import { getPageMedia, mediaUrl, getSectionCards } from "@/lib/site-media";
import { SCHOOL } from "@nkps/shared/lib/constants";
import { SITE_URL, SCHOOL_ID, buildMetadata, breadcrumbJsonLd } from "@nkps/shared/lib/seo";

export const metadata: Metadata = buildMetadata({
  title: "About Us – Legacy Since 1985",
  description:
    "NK Public School, Murlipura was founded in 1985 by Late Shri R.K. Choudhary — four decades of discipline, academic excellence and character in Jaipur.",
  path: "/about",
});

export const revalidate = 60;

export default async function AboutPage() {
  const [media, leadershipCards, timelineCards, whyChooseCards] = await Promise.all([
    getPageMedia("about"),
    getSectionCards("leadership"),
    getSectionCards("legacy_timeline"),
    getSectionCards("why_choose_us"),
  ]);

  const aboutHeroImage = mediaUrl(media, "about_hero", "/images/gallery/g10.jpg");
  const founderPhoto = mediaUrl(media, "founder_photo", "/images/about/rk-choudhary.png");

  const absolute = (url: string) => (url.startsWith("/") ? `${SITE_URL}${url}` : url);

  // Who runs the school, tied to the site-wide School entity — helps search
  // engines connect the leadership (E-E-A-T) to the organisation.
  const aboutJsonLd = {
    "@context": "https://schema.org",
    "@type": "AboutPage",
    url: `${SITE_URL}/about`,
    name: `About ${SCHOOL.name}`,
    about: { "@id": SCHOOL_ID },
    mentions: [
      {
        "@type": "Person",
        name: SCHOOL.founder.name,
        description: SCHOOL.founder.bio,
        image: absolute(founderPhoto),
        affiliation: { "@id": SCHOOL_ID },
      },
      ...leadershipCards
        .filter((c) => c.name)
        .map((c) => ({
          "@type": "Person",
          name: c.name,
          jobTitle: c.designation || undefined,
          image: c.image_url ? absolute(c.image_url) : undefined,
          worksFor: { "@id": SCHOOL_ID },
        })),
    ],
  };

  return (
    <PageTransition>
      <JsonLd data={aboutJsonLd} />
      <JsonLd
        data={breadcrumbJsonLd([
          { name: "Home", path: "/" },
          { name: "About", path: "/about" },
        ])}
      />
      <PageHeader
        title="About NK Public School"
        subtitle="Shaping Futures, Building Character"
      />

      <VisionMission />

      {/* Hero Image Section */}
      <div className="relative h-[50vh] w-full overflow-hidden">
        <Image
          src={aboutHeroImage}
          alt="NK Public School, Murlipura — Arya Nagar campus, Jaipur"
          fill
          className="object-cover"
          preload
        />
        <div className="absolute inset-0 bg-gradient-to-b from-navy-950/70 via-navy-900/50 to-navy-950/80" />
        <div className="absolute inset-0 flex flex-col items-center justify-center px-6 text-center">
          <h2 className="font-heading text-4xl font-bold text-white md:text-5xl">
            Our Story
          </h2>
          <p className="mt-4 max-w-2xl text-lg text-gray-200 md:text-xl">
            Four decades of nurturing young minds with discipline, knowledge, and
            values rooted in the vision of our founder.
          </p>
        </div>
      </div>

      <SectionDivider color="fill-board" />

      <LegacyTimeline cards={timelineCards} />
      <FounderTribute photoUrl={founderPhoto} />

      <SectionDivider color="fill-board" />

      <LeadershipGrid cards={leadershipCards} />
      <WhyChooseUs cards={whyChooseCards} />

      <SectionDivider flip color="fill-board-deep" />

      <AchievementsCounter />
    </PageTransition>
  );
}
