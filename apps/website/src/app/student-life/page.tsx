import { Metadata } from "next";
import { StudentLifeContent } from "./StudentLifeContent";
import { JsonLd } from "@/components/seo/JsonLd";
import { getSectionCards } from "@/lib/site-media";
import { buildMetadata, breadcrumbJsonLd } from "@nkps/shared/lib/seo";

export const metadata: Metadata = buildMetadata({
  title: "Student Life & Activities",
  description:
    "Student council, houses, music, dance, art, debate, quiz and science clubs, and annual events at NK Public School, Murlipura, Jaipur.",
  path: "/student-life",
});

export const revalidate = 60;

export default async function StudentLifePage() {
  const [
    activityCards,
    eventCards,
    sportsIndoorCards,
    sportsOutdoorCards,
    councilCards,
    houseCaptainCards,
  ] = await Promise.all([
    getSectionCards("activities"),
    getSectionCards("annual_events"),
    getSectionCards("sports_indoor"),
    getSectionCards("sports_outdoor"),
    getSectionCards("student_council"),
    getSectionCards("house_captains"),
  ]);

  return (
    <>
      <JsonLd
        data={breadcrumbJsonLd([
          { name: "Home", path: "/" },
          { name: "Student Life", path: "/student-life" },
        ])}
      />
      <StudentLifeContent
        activityCards={activityCards}
        eventCards={eventCards}
        sportsIndoorCards={sportsIndoorCards}
        sportsOutdoorCards={sportsOutdoorCards}
        councilCards={councilCards}
        houseCaptainCards={houseCaptainCards}
      />
    </>
  );
}
